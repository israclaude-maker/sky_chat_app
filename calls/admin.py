from django.contrib import admin
from calls.models import Call

@admin.register(Call)
class CallAdmin(admin.ModelAdmin):
    list_display = ('id', 'caller', 'receiver', 'call_type', 'status', 'formatted_duration', 'created_at')
    list_filter = ('call_type', 'status', 'created_at')
    search_fields = ('caller__username', 'receiver__username')
    ordering = ('-created_at',)

    def formatted_duration(self, obj):
        s = obj.duration or 0
        h = s // 3600
        m = (s % 3600) // 60
        sec = s % 60
        if h > 0:
            return f"{h}h {m}m {sec}s"
        elif m > 0:
            return f"{m}m {sec}s"
        return f"{sec}s"
    formatted_duration.short_description = 'Duration'
    formatted_duration.admin_order_field = 'duration'
