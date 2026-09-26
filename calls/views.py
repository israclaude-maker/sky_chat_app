from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Call, GroupCall, GroupCallParticipant
import os
import json
import anthropic
from django.conf import settings
from .models import Call, GroupCall, GroupCallParticipant, TranscriptFragment, MeetingSummary


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def call_history(request):
    user = request.user
    results = []

    # 1-on-1 calls
    dm_calls = Call.objects.filter(
        Q(caller=user) | Q(receiver=user)
    ).select_related('caller', 'receiver').order_by('-created_at')[:50]

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
            'created_at': gc.started_at.isoformat(),
            'group': group_data,
            'participants': parts,
        })

    # Sort combined by created_at descending
    results.sort(key=lambda x: x['created_at'], reverse=True)
    return Response(results[:50])

client = anthropic.Anthropic(api_key=settings.CLAUDE_API_KEY)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_transcript_fragment(request):
    text = (request.data.get("text") or "").strip()
    call_id = request.data.get("call_id")
    group_call_id = request.data.get("group_call_id")

    print(f"[TRANSCRIPT] Received: call_id={call_id}, group_call_id={group_call_id}, text_len={len(text)}")

    if not text:
        print("[TRANSCRIPT] Empty text, skipping")
        return Response({"status": "skipped", "reason": "empty text"})

    call_obj = Call.objects.filter(id=call_id).first() if call_id else None
    group_call_obj = GroupCall.objects.filter(id=group_call_id).first() if group_call_id else None

    print(f"[TRANSCRIPT] call_obj={call_obj}, group_call_obj={group_call_obj}")

    if not call_obj and not group_call_obj:
        print("[TRANSCRIPT] Neither call nor group_call found — returning 400")
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
    aur MeetingSummary save karta hai. call ya group_call mein se koi ek dena zaroori hai.
    """
    if call:
        fragments = TranscriptFragment.objects.filter(call=call).select_related("user").order_by("created_at")
    elif group_call:
        fragments = TranscriptFragment.objects.filter(group_call=group_call).select_related("user").order_by("created_at")
    else:
        return None

    if not fragments.exists():
        return None

    # Speaker name ke sath merge karna
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
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw_reply = message.content[0].text.strip()
        raw_reply = raw_reply.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_reply)
    except Exception as e:
        print(f"[MeetingSummary] Claude API error: {e}")
        parsed = {"summary": "", "key_points": [], "action_items": []}

    meeting = MeetingSummary.objects.create(
        call=call,
        group_call=group_call,
        raw_transcript=merged_transcript,
        summary=parsed.get("summary", ""),
        key_points=parsed.get("key_points", []),
        action_items=parsed.get("action_items", []),
    )
    return meeting