from django.urls import path, include
from rest_framework.routers import DefaultRouter
from accounts.views import UserViewSet, MessageViewSet

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'messages', MessageViewSet, basename='messages')

urlpatterns = [
    path('', include(router.urls)),
]
