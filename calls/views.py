import json
import anthropic
from django.conf import settings
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Call, GroupCall, GroupCallParticipant, TranscriptFragment, MeetingSummary


def _claude_client():
    return anthropic.Anthropic(api_key=settings.CLAUDE_API_KEY)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def call_history(request):
    user = request.user
    results = []

    # 1-on-1 calls
    dm_calls = Call.objects.filter(
        Q(caller=user) | Q(receiver=user)
    ).select_related('caller', 'receiver').order_by('-created_at')[:50]

    dm_call_ids = [c.id for c in dm_calls]
    transcript_call_ids = set(
        TranscriptFragment.objects.filter(call_id__in=dm_call_ids).values_list('call_id', flat=True)
    )

    for call in dm_calls:
        is_outgoing = call.caller_id == user.id
        other = call.receiver if is_outgoing else call.caller
        results.append({
            'id': call.id,
            'type': 'dm',
            'call_type': call.call_type,
            'status': call.status,
            'is_outgoing': is_outgoing,
            'duration': call.duration,
            'has_transcript': call.id in transcript_call_ids,
            'created_at': call.created_at.isoformat(),
            'other_user': {
                'id': other.id,
                'username': other.username,
                'first_name': other.first_name,
                'last_name': other.last_name,
                'profile_picture': other.profile_picture.url if other.profile_picture else None,
            }
        })

    # Group calls where user participated
    gc_participations = GroupCallParticipant.objects.filter(
        user=user
    ).select_related('group_call', 'group_call__group', 'group_call__initiator').order_by('-group_call__started_at')[:30]

    gc_ids = [g.group_call_id for g in gc_participations]
    transcript_gc_ids = set(
        TranscriptFragment.objects.filter(group_call_id__in=gc_ids).values_list('group_call_id', flat=True)
    )

    for gcp in gc_participations:
        gc = gcp.group_call
        participants = GroupCallParticipant.objects.filter(
            group_call=gc
        ).select_related('user').exclude(user=user)

        parts = []
        for p in participants:
            parts.append({
                'id': p.user.id,
                'name': p.user.get_full_name() or p.user.username,
                'profile_picture': p.user.profile_picture.url if p.user.profile_picture else None,
            })

        group_data = None
        if gc.group:
            group_data = {
                'id': gc.group.id,
                'name': gc.group.name,
                'group_picture': gc.group.group_picture.url if gc.group.group_picture else None,
            }

        results.append({
            'id': f'gc_{gc.id}',
            'type': 'group',
            'call_type': gc.call_type,
            'status': gc.status,
            'is_outgoing': gc.initiator_id == user.id,
            'duration': 0,
            'group_call_id': gc.id,
            'has_transcript': gc.id in transcript_gc_ids,
            'created_at': gc.started_at.isoformat(),
            'group': group_data,
            'participants': parts,
        })

    results.sort(key=lambda x: x['created_at'], reverse=True)
    return Response(results[:50])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_transcript_fragment(request):
    text = (request.data.get("text") or "").strip()
    call_id = request.data.get("call_id")
    group_call_id = request.data.get("group_call_id")

    print(f"[TRANSCRIPT] Received: call_id={call_id}, group_call_id={group_call_id}, text_len={len(text)}")

    if not text:
        return Response({"status": "skipped", "reason": "empty text"})

    call_obj = Call.objects.filter(id=call_id).first() if call_id else None
    group_call_obj = GroupCall.objects.filter(id=group_call_id).first() if group_call_id else None

    if not call_obj and not group_call_obj:
        print("[TRANSCRIPT] Neither call nor group_call found")
        return Response({"error": "call_id or group_call_id required"}, status=400)

    fragment = TranscriptFragment.objects.create(
        call=call_obj,
        group_call=group_call_obj,
        user=request.user,
        text=text,
    )
    print(f"[TRANSCRIPT] Saved fragment id={fragment.id}")
    return Response({"status": "saved"})


def generate_meeting_summary(call=None, group_call=None):
    """
    Sab TranscriptFragments ko time-order mein merge karke Claude ko bhejta hai,
    aur MeetingSummary save karta hai.
    """
    if call:
        fragments = TranscriptFragment.objects.filter(call=call).select_related("user").order_by("created_at")
    elif group_call:
        fragments = TranscriptFragment.objects.filter(group_call=group_call).select_related("user").order_by("created_at")
    else:
        return None

    if not fragments.exists():
        return None

    lines = []
    for f in fragments:
        speaker = f.user.first_name or f.user.username
        lines.append(f"{speaker}: {f.text}")
    merged_transcript = "\n".join(lines)

    prompt = f"""Yeh ek meeting/call ka transcript hai, jisme har line ke shuru mein speaker ka naam hai. Isse analyze karke sirf valid JSON return karein, koi extra text nahi, format:

{{
  "summary": "2-3 line ka short summary",
  "key_points": ["point 1", "point 2"],
  "action_items": ["action 1", "action 2"]
}}

Transcript:
{merged_transcript}
"""

    try:
        message = _claude_client().messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw_reply = message.content[0].text.strip()
        raw_reply = raw_reply.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_reply)
    except Exception as e:
        print(f"[MeetingSummary] Claude API error: {e}")
        return None

    meeting = MeetingSummary.objects.create(
        call=call,
        group_call=group_call,
        raw_transcript=merged_transcript,
        summary=parsed.get("summary", ""),
        key_points=parsed.get("key_points", []),
        action_items=parsed.get("action_items", []),
    )
    return meeting


def _get_or_build_summary(call=None, group_call=None):
    """Summary lautata hai. Nahi hai (ya naya transcript aaya hai) to Claude se banata hai."""
    if call:
        frags = TranscriptFragment.objects.filter(call=call)
        summary = MeetingSummary.objects.filter(call=call).first()
    else:
        frags = TranscriptFragment.objects.filter(group_call=group_call)
        summary = MeetingSummary.objects.filter(group_call=group_call).first()

    if not frags.exists():
        return None

    latest = frags.order_by('-created_at').first().created_at
    if summary and summary.summary and summary.created_at >= latest:
        return summary

    if summary:
        summary.delete()
    return generate_meeting_summary(call=call, group_call=group_call)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_meeting_summary(request):
    user = request.user
    call_id = request.GET.get('call_id')
    group_call_id = request.GET.get('group_call_id')
    summary = None

    if call_id:
        call = Call.objects.filter(id=call_id).filter(Q(caller=user) | Q(receiver=user)).first()
        if call:
            summary = _get_or_build_summary(call=call)
    elif group_call_id:
        gc = GroupCall.objects.filter(id=group_call_id, participants__user=user).first()
        if gc:
            summary = _get_or_build_summary(group_call=gc)

    if not summary or not summary.summary:
        return Response({'found': False}, status=404)

    return Response({
        'found': True,
        'summary': summary.summary,
        'key_points': summary.key_points or [],
        'action_items': summary.action_items or [],
        'created_at': summary.created_at.isoformat(),
    })