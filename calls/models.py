from django.db import models
from django.conf import settings

class Call(models.Model):
    CALL_TYPE_CHOICES = (
        ('voice', 'Voice Call'),
        ('video', 'Video Call'),
    )

    CALL_STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
        ('missed', 'Missed'),
        ('completed', 'Completed'),
    )

    caller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='calls_made')
    receiver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='calls_received')
    call_type = models.CharField(max_length=10, choices=CALL_TYPE_CHOICES)
    status = models.CharField(max_length=10, choices=CALL_STATUS_CHOICES, default='pending')
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration = models.IntegerField(default=0, help_text="Duration in seconds")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.caller.username} -> {self.receiver.username} ({self.call_type})"


class GroupCall(models.Model):
    CALL_TYPE_CHOICES = (
        ('voice', 'Voice Call'),
        ('video', 'Video Call'),
    )
    STATUS_CHOICES = (
        ('active', 'Active'),
        ('ended', 'Ended'),
    )

    group = models.ForeignKey('chat.Group', on_delete=models.CASCADE, related_name='group_calls', null=True, blank=True)
    initiator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='initiated_group_calls')
    call_type = models.CharField(max_length=10, choices=CALL_TYPE_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f"GroupCall {self.id} in {self.group.name} ({self.call_type})"


class GroupCallParticipant(models.Model):
    group_call = models.ForeignKey(GroupCall, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('group_call', 'user')

    def __str__(self):
        return f"{self.user.username} in GroupCall {self.group_call.id}"
