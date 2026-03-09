import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from chat.models import Conversation, Message
from calls.models import Call
from datetime import datetime

User = get_user_model()

# Global mapping of user_id to channel_name for direct messaging
connected_users = {}

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if not self.user.is_authenticated:
            await self.close()
            return

        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'

        print(f"[WS] User {self.user.id} ({self.user.username}) connecting to room: {self.room_name}")

        # Set user online
        await self.set_user_online(True)
        
        # Add to connected users
        connected_users[self.user.id] = self.channel_name
        
        # Also join a personal channel for call signaling
        self.personal_group = f'user_{self.user.id}'
        await self.channel_layer.group_add(self.personal_group, self.channel_name)
        print(f"[WS] User {self.user.id} joined personal group: {self.personal_group}")
        
        # Join room group
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_join',
                'username': self.user.username,
            }
        )

    async def disconnect(self, close_code):
        # Only do cleanup if user was authenticated
        if not self.user.is_authenticated:
            return
            
        # Update last seen
        await self.update_last_seen()
        
        # Remove from connected users
        if self.user.id in connected_users:
            del connected_users[self.user.id]
        
        # Leave personal group
        if hasattr(self, 'personal_group'):
            await self.channel_layer.group_discard(self.personal_group, self.channel_name)
        
        # Leave room group
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_leave',
                    'username': self.user.username,
                }
            )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message_type = data.get('type')

        if message_type == 'chat.message':
            await self.handle_chat_message(data)
        elif message_type == 'call_initiate':
            await self.handle_call_initiate(data)
        elif message_type == 'call_accept':
            await self.handle_call_accept(data)
        elif message_type == 'call_reject':
            await self.handle_call_reject(data)
        elif message_type == 'call_end':
            await self.handle_call_end(data)
        elif message_type == 'call_cancel':
            await self.handle_call_cancel(data)
        elif message_type == 'call_ice':
            await self.handle_call_ice(data)

    async def handle_chat_message(self, data):
        message = data['message']
        receiver_username = data.get('receiver')
        group_id = data.get('group_id')
        reply_to = data.get('reply_to')
        is_forwarded = data.get('is_forwarded', False)

        if group_id:
            # Group message
            msg = await self.save_group_message(message, group_id, reply_to)
        else:
            # Direct message
            msg = await self.save_message(message, receiver_username, reply_to)

        # Get sender profile picture
        sender_profile_picture = None
        if self.user.profile_picture:
            sender_profile_picture = self.user.profile_picture.url

        # Get reply data if replying to a message
        reply_data = None
        if reply_to:
            reply_data = await self.get_reply_data(reply_to)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'username': self.user.username,
                'display_name': f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username,
                'profile_picture': sender_profile_picture,
                'timestamp': datetime.now().isoformat(),
                'message_id': msg.id if msg else None,
                'reply_to': reply_to,
                'reply_data': reply_data,
                'is_forwarded': is_forwarded,
            }
        )

    async def handle_call_initiate(self, data):
        receiver_id = data.get('receiver_id')
        call_type = data.get('call_type', 'voice')
        sdp = data.get('sdp')

        print(f"[CALL] User {self.user.id} ({self.user.username}) initiating {call_type} call to user {receiver_id}")

        receiver = await self.get_user_by_id(receiver_id)
        if not receiver:
            print(f"[CALL] Receiver {receiver_id} not found!")
            return

        call = await self.create_call(receiver_id, call_type)
        print(f"[CALL] Created call {call.id if call else 'None'}, sending to user_{receiver_id}")

        caller_profile_picture = None
        if self.user.profile_picture:
            caller_profile_picture = self.user.profile_picture.url

        # Send to receiver's personal channel
        await self.channel_layer.group_send(
            f'user_{receiver_id}',
            {
                'type': 'call_incoming',
                'caller_id': self.user.id,
                'caller_username': self.user.username,
                'caller_name': f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username,
                'caller_profile_picture': caller_profile_picture,
                'call_type': call_type,
                'call_id': call.id if call else None,
                'sdp': data.get('sdp'),
            }
        )
        print(f"[CALL] Call notification sent to user_{receiver_id}")

    async def handle_call_accept(self, data):
        call_id = data.get('call_id')
        caller_id = data.get('caller_id')
        sdp = data.get('sdp')
        
        await self.update_call_status(call_id, 'accepted')

        # Send acceptance to caller
        await self.channel_layer.group_send(
            f'user_{caller_id}',
            {
                'type': 'call_accepted',
                'call_id': call_id,
                'accepter_id': self.user.id,
                'sdp': sdp,
            }
        )

    async def handle_call_reject(self, data):
        call_id = data.get('call_id')
        caller_id = data.get('caller_id')
        reason = data.get('reason', 'rejected')
        
        await self.update_call_status(call_id, 'rejected')

        # Send rejection to caller
        await self.channel_layer.group_send(
            f'user_{caller_id}',
            {
                'type': 'call_rejected',
                'call_id': call_id,
                'reason': reason,
            }
        )

    async def handle_call_end(self, data):
        call_id = data.get('call_id')
        target_user_id = data.get('target_user_id')
        duration = data.get('duration', 0)
        
        await self.end_call(call_id, duration)

        # Notify the other party
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'call_ended',
                'call_id': call_id,
            }
        )
        
    async def handle_call_cancel(self, data):
        receiver_id = data.get('receiver_id')
        
        # Notify receiver that call was cancelled
        await self.channel_layer.group_send(
            f'user_{receiver_id}',
            {
                'type': 'call_cancelled',
            }
        )
        
    async def handle_call_ice(self, data):
        target_user_id = data.get('target_user_id')
        candidate = data.get('candidate')
        
        # Forward ICE candidate to target
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'call_ice',
                'candidate': candidate,
            }
        )

    # ═══════════════════════════════════════════════════════════
    # GROUP SEND HANDLERS (called by channel_layer.group_send)
    # ═══════════════════════════════════════════════════════════

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat.message',
            'message': event['message'],
            'username': event['username'],
            'display_name': event.get('display_name', event['username']),
            'profile_picture': event.get('profile_picture'),
            'timestamp': event['timestamp'],
            'message_id': event.get('message_id'),
            'reply_to': event.get('reply_to'),
            'reply_data': event.get('reply_data'),
            'is_forwarded': event.get('is_forwarded', False),
        }))

    async def voice_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'voice_message',
            'id': event['id'],
            'message_id': event['message_id'],
            'message': event['message'],
            'message_type': 'voice',
            'file_url': event['file_url'],
            'file_name': event.get('file_name', ''),
            'duration': event.get('duration', 0),
            'sender_id': event['sender_id'],
            'username': event['username'],
            'display_name': event.get('display_name', event['username']),
            'timestamp': event['timestamp'],
            'status': event.get('status', 'sent'),
        }))

    async def call_incoming(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_incoming',
            'caller_id': event['caller_id'],
            'caller_username': event['caller_username'],
            'caller_name': event['caller_name'],
            'caller_profile_picture': event.get('caller_profile_picture'),
            'call_type': event['call_type'],
            'call_id': event['call_id'],
            'sdp': event.get('sdp'),
        }))

    async def call_accepted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_accepted',
            'call_id': event['call_id'],
            'accepter_id': event['accepter_id'],
            'sdp': event.get('sdp'),
        }))

    async def call_rejected(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_rejected',
            'call_id': event['call_id'],
            'reason': event.get('reason', 'rejected'),
        }))

    async def call_ended(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_ended',
            'call_id': event['call_id'],
        }))
        
    async def call_cancelled(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_cancelled',
        }))
        
    async def call_ice(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_ice',
            'candidate': event['candidate'],
        }))

    async def user_join(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user.join',
            'username': event['username'],
        }))

    async def user_leave(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user.leave',
            'username': event['username'],
        }))

    # ═══════════════════════════════════════════════════════════
    # DATABASE HELPERS
    # ═══════════════════════════════════════════════════════════

    @database_sync_to_async
    def save_message(self, message, receiver_username, reply_to=None):
        try:
            receiver = User.objects.get(username=receiver_username)
            participants = sorted([self.user.id, receiver.id])

            conversation, _ = Conversation.objects.get_or_create(
                participant1_id=participants[0],
                participant2_id=participants[1]
            )

            msg = Message.objects.create(
                conversation=conversation,
                sender=self.user,
                content=message,
                reply_to_id=reply_to
            )
            return msg
        except User.DoesNotExist:
            return None

    @database_sync_to_async
    def save_group_message(self, message, group_id, reply_to=None):
        from chat.models import Group
        try:
            group = Group.objects.get(id=group_id)
            msg = Message.objects.create(
                group=group,
                sender=self.user,
                content=message,
                reply_to_id=reply_to
            )
            return msg
        except Group.DoesNotExist:
            return None

    @database_sync_to_async
    def get_user_by_id(self, user_id):
        try:
            return User.objects.get(id=user_id)
        except User.DoesNotExist:
            return None

    @database_sync_to_async
    def create_call(self, receiver_id, call_type):
        try:
            receiver = User.objects.get(id=receiver_id)
            call = Call.objects.create(
                caller=self.user,
                receiver=receiver,
                call_type=call_type,
                status='pending'
            )
            return call
        except User.DoesNotExist:
            return None

    @database_sync_to_async
    def update_call_status(self, call_id, status):
        try:
            call = Call.objects.get(id=call_id)
            call.status = status
            if status == 'accepted':
                call.started_at = datetime.now()
            call.save()
        except Call.DoesNotExist:
            pass

    @database_sync_to_async
    def end_call(self, call_id, duration):
        try:
            call = Call.objects.get(id=call_id)
            call.status = 'completed'
            call.ended_at = datetime.now()
            call.duration = duration
            call.save()
        except Call.DoesNotExist:
            pass

    @database_sync_to_async
    def update_last_seen(self):
        from django.utils import timezone
        if self.user.is_authenticated:
            self.user.last_seen = timezone.now()
            self.user.is_online = False
            self.user.save(update_fields=['last_seen', 'is_online'])

    @database_sync_to_async
    def set_user_online(self, online):
        from django.utils import timezone
        if self.user.is_authenticated:
            self.user.is_online = online
            if online:
                self.user.last_seen = timezone.now()
            self.user.save(update_fields=['is_online', 'last_seen'])

    @database_sync_to_async
    def get_reply_data(self, message_id):
        """Get the original message data for reply preview"""
        try:
            msg = Message.objects.select_related('sender').get(id=message_id)
            sender_name = f"{msg.sender.first_name} {msg.sender.last_name}".strip() or msg.sender.username
            return {
                'text': msg.content or '',
                'sender': sender_name,
            }
        except Message.DoesNotExist:
            return None