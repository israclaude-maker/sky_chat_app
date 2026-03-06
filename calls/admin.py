from django.contrib import admin
from calls.models import Call

@admin.register(Call)
class CallAdmin(admin.ModelAdmin):
    list_display = ('id', 'caller', 'receiver', 'call_type', 'status', 'duration', 'created_at')
    list_filter = ('call_type', 'status', 'created_at')
    search_fields = ('caller__username', 'receiver__username')
    ordering = ('-created_at',)
