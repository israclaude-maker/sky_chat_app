from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required

def chat(request):
    # Check if user has valid JWT token via JavaScript
    # For server-side check, verify session or redirect
    return render(request, 'chat/index.html')


import requests
from django.http import JsonResponse
from django.views.decorators.http import require_GET

@require_GET
def get_turn_credentials(request):
    try:
        resp = requests.get(
            'https://skyightchat-app.metered.live/api/v1/turn/credentials',
            params={'apiKey': '81c8c65b552199965818eae2c6927b1c8e29'},
            timeout=5
        )
        return JsonResponse(resp.json(), safe=False)
    except Exception:
        return JsonResponse([
            {'urls': 'stun:stun.l.google.com:19302'},
            {'urls': 'turn:switchback.proxy.rlwy.net:56157',
             'username': 'skyuser',
             'credential': 'skypass123'},
        ], safe=False)


from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from calls.models import GroupCall, GroupCallParticipant
from django.utils import timezone as tz

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def active_group_calls(request):
    """Return all active group calls for groups the user belongs to."""
    user = request.user
    # Get all groups the user is a member of
    user_group_ids = user.chat_groups.values_list('id', flat=True)
    # Get active group calls in those groups
    calls = GroupCall.objects.filter(
        group_id__in=user_group_ids,
        status='active',
    ).select_related('group', 'initiator')

    result = []
    for gc in calls:
        # Auto-end calls older than 2 hours (stale safety net)
        if gc.started_at and (tz.now() - gc.started_at).total_seconds() > 7200:
            gc.status = 'ended'
            gc.ended_at = tz.now()
            gc.save(update_fields=['status', 'ended_at'])
            continue

        # Only include calls that have active participants
        active_count = GroupCallParticipant.objects.filter(
            group_call=gc, left_at__isnull=True
        ).count()
        if active_count == 0:
            # Stale call — clean up
            gc.status = 'ended'
            gc.ended_at = tz.now()
            gc.save(update_fields=['status', 'ended_at'])
            continue

        initiator = gc.initiator
        caller_name = f"{initiator.first_name} {initiator.last_name}".strip() or initiator.username
        caller_pic = initiator.profile_picture.url if initiator.profile_picture else None
        result.append({
            'group_call_id': gc.id,
            'group_id': gc.group_id,
            'call_type': gc.call_type,
            'caller_name': caller_name,
            'caller_pic': caller_pic,
            'group_name': gc.group.name if gc.group else 'Group Call',
            'started_at': gc.started_at.isoformat() if gc.started_at else None,
        })
    return JsonResponse(result, safe=False)