from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Call, GroupCall, GroupCallParticipant


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
