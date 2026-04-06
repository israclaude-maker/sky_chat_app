from django.contrib import admin
from chat.models import Conversation, Message, Group, GroupMembership, MessageReadReceipt

@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ('id', 'participant1', 'participant2', 'created_at', 'updated_at')
    list_filter = ('created_at',)
    search_fields = ('participant1__username', 'participant2__username')
    ordering = ('-updated_at',)

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'sender', 'conversation', 'group', 'timestamp', 'is_read')
    list_filter = ('is_read', 'timestamp', 'message_type')
    search_fields = ('sender__username', 'content')
    ordering = ('-timestamp',)

@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'created_by', 'member_count', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('name', 'description')
    filter_horizontal = ('members', 'admins')
    ordering = ('-updated_at',)

    def member_count(self, obj):
        return obj.members.count()
    member_count.short_description = 'Members'

@admin.register(MessageReadReceipt)
class MessageReadReceiptAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'user', 'read_at')
    list_filter = ('read_at',)
    ordering = ('-read_at',)
