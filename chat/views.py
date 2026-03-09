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