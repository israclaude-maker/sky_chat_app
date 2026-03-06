from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required

def chat(request):
    # Check if user has valid JWT token via JavaScript
    # For server-side check, verify session or redirect
    return render(request, 'chat/index.html')
