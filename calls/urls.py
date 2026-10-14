from django.urls import path
from . import views

urlpatterns = [
    path('save-transcript-fragment/', views.save_transcript_fragment, name='save_transcript_fragment'),
    path('summary/', views.get_meeting_summary, name='get_meeting_summary'),
]