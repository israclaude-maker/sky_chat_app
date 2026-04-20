import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from chat.models import Conversation, Message, MessageReadReceipt, Group
from calls.models import Call, GroupCall, GroupCallParticipant
from chat.push import send_push_notification
from chat.fcm import send_fcm_notification, send_fcm_call_notification, send_fcm_call_cancel
from django.utils import timezone as djtz

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

        # Broadcast online status to contacts
        await self.broadcast_online_status(True)

    async def disconnect(self, close_code):
        # Only do cleanup if user was authenticated
        if not self.user.is_authenticated:
            return

        # Broadcast offline status before cleanup
        await self.broadcast_online_status(False)
            
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
        elif message_type == 'typing':
            await self.handle_typing(data)
        elif message_type == 'group_read':
            await self.handle_group_read(data)
        elif message_type == 'group_system':
            await self.handle_group_system(data)
        elif message_type == 'message_edit':
            await self.handle_message_edit(data)
        elif message_type == 'reaction':
            await self.handle_reaction(data)
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
        # Group call signaling
        elif message_type == 'group_call_start':
            await self.handle_group_call_start(data)
        elif message_type == 'group_call_join':
            await self.handle_group_call_join(data)
        elif message_type == 'group_call_offer':
            await self.handle_group_call_offer(data)
        elif message_type == 'group_call_answer':
            await self.handle_group_call_answer(data)
        elif message_type == 'group_call_ice':
            await self.handle_group_call_ice(data)
        elif message_type == 'group_call_leave':
            await self.handle_group_call_leave(data)
        elif message_type == 'call_upgrade':
            await self.handle_call_upgrade(data)
        elif message_type == 'group_call_invite':
            await self.handle_group_call_invite(data)
        elif message_type == 'gc_screen_toggle':
            await self.handle_gc_screen_toggle(data)
        elif message_type == 'screen_offer':
            await self.handle_screen_offer(data)
        elif message_type == 'screen_answer':
            await self.handle_screen_answer(data)
        elif message_type == 'screen_toggle':
            await self.handle_screen_toggle(data)

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
                'timestamp': djtz.now().isoformat(),
                'message_id': msg.id if msg else None,
                'reply_to': reply_to,
                'reply_data': reply_data,
                'is_forwarded': is_forwarded,
                'group_id': group_id,
            }
        )

        # Send Web Push to offline users
        sender_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        push_body = message[:200] if message else 'Sent a file'
        if group_id:
            # Push to all group members except sender
            await self.send_group_push(group_id, sender_name, push_body, sender_profile_picture)
            # Notify all group members' personal channels (sidebar update)
            member_ids = await self.get_group_member_ids(group_id)
            for mid in member_ids:
                if mid != self.user.id:
                    await self.channel_layer.group_send(
                        f'user_{mid}',
                        {
                            'type': 'new_message_notify',
                            'sender_id': self.user.id,
                            'sender_name': sender_name,
                            'sender_pic': sender_profile_picture,
                            'message': message[:200] if message else '',
                            'group_id': group_id,
                            'group_name': await self.get_group_name(group_id),
                            'timestamp': djtz.now().isoformat(),
                        }
                    )
        else:
            # Push to DM receiver
            await self.send_dm_push(receiver_username, sender_name, push_body, sender_profile_picture)
            # Notify receiver's personal channel (sidebar update in other chats)
            receiver_id = await self.get_user_id_by_username(receiver_username)
            if receiver_id:
                await self.channel_layer.group_send(
                    f'user_{receiver_id}',
                    {
                        'type': 'new_message_notify',
                        'sender_id': self.user.id,
                        'sender_name': sender_name,
                        'sender_pic': sender_profile_picture,
                        'message': message[:200] if message else '',
                        'group_id': None,
                        'timestamp': djtz.now().isoformat(),
                    }
                )

    async def handle_group_read(self, data):
        """Handle group message read receipts"""
        group_id = data.get('group_id')
        message_ids = data.get('message_ids', [])
        
        if not group_id or not message_ids:
            return
        
        read_info = await self.save_group_read_receipts(message_ids, group_id)
        
        # Broadcast read receipt to group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'group_read_receipt',
                'reader_id': self.user.id,
                'reader_name': f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username,
                'message_ids': message_ids,
                'read_at': djtz.now().isoformat(),
                'read_counts': read_info.get('read_counts', {}),
                'member_count': read_info.get('member_count', 0),
            }
        )

    async def handle_group_system(self, data):
        """Handle system messages for group events"""
        action = data.get('action')
        group_id = data.get('group_id')
        target_user_id = data.get('target_user_id')
        system_message = data.get('system_message', '')
        
        if system_message:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'system_message',
                    'message': system_message,
                    'action': action,
                    'actor_id': self.user.id,
                    'target_user_id': target_user_id,
                    'timestamp': djtz.now().isoformat(),
                }
            )

    async def handle_message_edit(self, data):
        """Broadcast message edit to all users in the room"""
        message_id = data.get('message_id')
        new_text = data.get('new_text', '')
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'message_edited',
                'message_id': message_id,
                'new_text': new_text,
                'username': self.user.username,
            }
        )

    async def message_edited(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_edited',
            'message_id': event['message_id'],
            'new_text': event['new_text'],
            'username': event['username'],
        }))

    async def handle_typing(self, data):
        """Broadcast typing indicator to room"""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'username': self.user.username,
                'display_name': f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username,
                'is_typing': data.get('is_typing', True),
            }
        )

    async def typing_indicator(self, event):
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps({
                'type': 'typing',
                'user_id': event['user_id'],
                'username': event['username'],
                'display_name': event['display_name'],
                'is_typing': event['is_typing'],
            }))

    async def handle_reaction(self, data):
        """Broadcast reaction to room"""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'reaction_update',
                'message_id': data.get('message_id'),
                'emoji': data.get('emoji'),
                'user_id': self.user.id,
                'username': self.user.username,
                'action': data.get('action', 'add'),
            }
        )

    async def reaction_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'reaction',
            'message_id': event['message_id'],
            'emoji': event['emoji'],
            'user_id': event['user_id'],
            'username': event['username'],
            'action': event['action'],
        }))

    async def broadcast_online_status(self, is_online):
        """Notify all contacts about online/offline status"""
        contact_ids = await self.get_contact_ids()
        last_seen = djtz.now().isoformat()
        for cid in contact_ids:
            await self.channel_layer.group_send(
                f'user_{cid}',
                {
                    'type': 'online_status',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_online': is_online,
                    'last_seen': last_seen,
                }
            )

    async def online_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'online_status',
            'user_id': event['user_id'],
            'username': event['username'],
            'is_online': event['is_online'],
            'last_seen': event['last_seen'],
        }))

    async def new_message_notify(self, event):
        """Cross-chat new message notification to personal channel"""
        await self.send(text_data=json.dumps({
            'type': 'new_message_notify',
            'sender_id': event['sender_id'],
            'sender_name': event['sender_name'],
            'sender_pic': event.get('sender_pic'),
            'message': event['message'],
            'group_id': event.get('group_id'),
            'group_name': event.get('group_name'),
            'timestamp': event['timestamp'],
        }))

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

        # Get caller profile picture URL
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
                'sdp': sdp,
            }
        )
        print(f"[CALL] Call notification sent to user_{receiver_id}")

        # Send Web Push for call (in case receiver is offline/background)
        caller_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        call_label = 'Video Call' if call_type == 'video' else 'Voice Call'
        await database_sync_to_async(send_push_notification)(
            receiver_id,
            f'Incoming {call_label}',
            f'{caller_name} is calling...',
            url='/chat/',
            icon=caller_profile_picture or '/static/icons/icon-192x192.png',
            tag='skychat-call'
        )
        # Also send via FCM (reliable even when app killed)
        await database_sync_to_async(send_fcm_call_notification)(
            receiver_id, caller_name, call_type,
            call_id=call.id if call else None,
            caller_id=self.user.id
        )

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

        # Send rejection to caller via WebSocket
        await self.channel_layer.group_send(
            f'user_{caller_id}',
            {
                'type': 'call_rejected',
                'call_id': call_id,
                'reason': reason,
            }
        )

        # Also send FCM cancel to BOTH parties to dismiss any lingering notification
        await database_sync_to_async(send_fcm_call_cancel)(caller_id, call_id)
        await database_sync_to_async(send_fcm_call_cancel)(self.user.id, call_id)

    async def handle_call_end(self, data):
        call_id = data.get('call_id')
        target_user_id = data.get('target_user_id')
        duration = data.get('duration', 0)
        
        await self.end_call(call_id, duration)

        # Notify the other party via WebSocket
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'call_ended',
                'call_id': call_id,
            }
        )

        # Also send FCM cancel to dismiss any lingering notification
        await database_sync_to_async(send_fcm_call_cancel)(target_user_id, call_id)
        
    async def handle_call_cancel(self, data):
        receiver_id = data.get('receiver_id')
        call_id = data.get('call_id')
        
        # Notify receiver that call was cancelled via WebSocket
        await self.channel_layer.group_send(
            f'user_{receiver_id}',
            {
                'type': 'call_cancelled',
                'call_id': call_id,
            }
        )

        # Also send FCM cancel to dismiss any lingering call notification
        await database_sync_to_async(send_fcm_call_cancel)(receiver_id, call_id)
        
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

    async def file_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'file_message',
            'id': event['id'],
            'message_id': event['message_id'],
            'message': event.get('message', ''),
            'message_type': event.get('message_type', 'file'),
            'file_url': event['file_url'],
            'file_name': event.get('file_name', ''),
            'file_size': event.get('file_size', 0),
            'sender_id': event['sender_id'],
            'username': event['username'],
            'display_name': event.get('display_name', event['username']),
            'timestamp': event['timestamp'],
            'status': event.get('status', 'sent'),
        }))

    async def group_read_receipt(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_read_receipt',
            'reader_id': event['reader_id'],
            'reader_name': event['reader_name'],
            'message_ids': event['message_ids'],
            'read_at': event['read_at'],
            'read_counts': event.get('read_counts', {}),
            'member_count': event.get('member_count', 0),
        }))

    async def system_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'system_message',
            'message': event['message'],
            'action': event.get('action', ''),
            'actor_id': event.get('actor_id'),
            'target_user_id': event.get('target_user_id'),
            'timestamp': event['timestamp'],
        }))

    async def call_incoming(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_incoming',
            'caller_id': event['caller_id'],
            'caller_username': event['caller_username'],
            'caller_name': event['caller_name'],
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
            'call_id': event.get('call_id'),
        }))
        
    async def call_ice(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_ice',
            'candidate': event['candidate'],
        }))

    # Screen share renegotiation
    async def handle_screen_offer(self, data):
        target_user_id = data.get('target_user_id')
        sdp = data.get('sdp')
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'screen_offer',
                'sdp': sdp,
                'sender_id': self.user.id,
            }
        )

    async def handle_screen_answer(self, data):
        target_user_id = data.get('target_user_id')
        sdp = data.get('sdp')
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'screen_answer',
                'sdp': sdp,
            }
        )

    async def screen_offer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_offer',
            'sdp': event['sdp'],
            'sender_id': event['sender_id'],
        }))

    async def screen_answer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_answer',
            'sdp': event['sdp'],
        }))

    async def handle_screen_toggle(self, data):
        target_user_id = data.get('target_user_id')
        sharing = data.get('sharing', False)
        await self.channel_layer.group_send(
            f'user_{target_user_id}',
            {
                'type': 'screen_toggle',
                'sharing': sharing,
            }
        )

    async def screen_toggle(self, event):
        await self.send(text_data=json.dumps({
            'type': 'screen_toggle',
            'sharing': event['sharing'],
        }))

    # ═══════════════════════════════════════════════════════════════
    # GROUP CALL HANDLERS
    # ═══════════════════════════════════════════════════════════════

    async def handle_group_call_start(self, data):
        """Initiator starts a group call — notify all group members (optional join)"""
        group_id = data.get('group_id')
        call_type = data.get('call_type', 'voice')
        gc = await self.create_group_call(group_id, call_type)
        if not gc:
            return
        member_ids = await self.get_group_member_ids(group_id)
        caller_pic = self.user.profile_picture.url if self.user.profile_picture else None
        caller_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        group_name = await self.get_group_name(group_id)
        for mid in member_ids:
            if mid != self.user.id:
                await self.channel_layer.group_send(
                    f'user_{mid}',
                    {
                        'type': 'group_call_notify',
                        'group_call_id': gc.id,
                        'group_id': group_id,
                        'group_name': group_name,
                        'call_type': call_type,
                        'caller_id': self.user.id,
                        'caller_name': caller_name,
                        'caller_pic': caller_pic,
                    }
                )
        # Send push notification to offline members
        await self.send_group_call_push(group_id, caller_name, group_name, call_type)
        # Caller auto-joins
        await self.send(text_data=json.dumps({
            'type': 'group_call_started',
            'group_call_id': gc.id,
            'group_id': group_id,
            'call_type': call_type,
        }))

    async def handle_group_call_join(self, data):
        """A member joins the group call — send offers to existing participants"""
        gc_id = data.get('group_call_id')
        await self.add_group_call_participant(gc_id)
        participant_ids = await self.get_group_call_participant_ids(gc_id)
        user_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        user_pic = self.user.profile_picture.url if self.user.profile_picture else None
        # Notify existing participants that a new user joined
        for pid in participant_ids:
            if pid != self.user.id:
                await self.channel_layer.group_send(
                    f'user_{pid}',
                    {
                        'type': 'group_call_user_joined',
                        'group_call_id': gc_id,
                        'user_id': self.user.id,
                        'user_name': user_name,
                        'user_pic': user_pic,
                    }
                )
        # Send joiner the list of existing participants
        participants = await self.get_group_call_participants_info(gc_id)
        await self.send(text_data=json.dumps({
            'type': 'group_call_joined',
            'group_call_id': gc_id,
            'participants': [p for p in participants if p['id'] != self.user.id],
        }))

    async def handle_group_call_offer(self, data):
        target_id = data.get('target_user_id')
        user = self.user
        await self.channel_layer.group_send(
            f'user_{target_id}',
            {
                'type': 'group_call_offer_relay',
                'group_call_id': data.get('group_call_id'),
                'from_user_id': user.id,
                'from_user_name': user.get_full_name() or user.username,
                'from_user_pic': user.profile_picture.url if user.profile_picture else '',
                'sdp': data.get('sdp'),
            }
        )

    async def handle_group_call_answer(self, data):
        target_id = data.get('target_user_id')
        await self.channel_layer.group_send(
            f'user_{target_id}',
            {
                'type': 'group_call_answer_relay',
                'group_call_id': data.get('group_call_id'),
                'from_user_id': self.user.id,
                'sdp': data.get('sdp'),
            }
        )

    async def handle_group_call_ice(self, data):
        target_id = data.get('target_user_id')
        await self.channel_layer.group_send(
            f'user_{target_id}',
            {
                'type': 'group_call_ice_relay',
                'group_call_id': data.get('group_call_id'),
                'from_user_id': self.user.id,
                'candidate': data.get('candidate'),
            }
        )

    async def handle_gc_screen_toggle(self, data):
        target_id = data.get('target_user_id')
        await self.channel_layer.group_send(
            f'user_{target_id}',
            {
                'type': 'gc_screen_toggle_relay',
                'group_call_id': data.get('group_call_id'),
                'from_user_id': self.user.id,
                'sharing': data.get('sharing', False),
            }
        )

    async def handle_group_call_leave(self, data):
        gc_id = data.get('group_call_id')
        await self.mark_group_call_left(gc_id)
        participant_ids = await self.get_group_call_participant_ids(gc_id)
        for pid in participant_ids:
            if pid != self.user.id:
                await self.channel_layer.group_send(
                    f'user_{pid}',
                    {
                        'type': 'group_call_user_left',
                        'group_call_id': gc_id,
                        'user_id': self.user.id,
                    }
                )
        # End call if no active participants
        active_count = await self.get_active_participant_count(gc_id)
        if active_count == 0:
            await self.end_group_call(gc_id)
            # Notify all group members that call ended (remove join banner)
            group_id = await self.get_group_id_from_call(gc_id)
            if group_id:
                member_ids = await self.get_group_member_ids(group_id)
                for mid in member_ids:
                    await self.channel_layer.group_send(
                        f'user_{mid}',
                        {
                            'type': 'group_call_ended_notify',
                            'group_call_id': gc_id,
                            'group_id': group_id,
                        }
                    )

    async def handle_call_upgrade(self, data):
        """Upgrade a 1-on-1 call to ad-hoc group call — like WhatsApp add user"""
        existing_peer_id = data.get('existing_peer_id')  # current call partner
        new_user_id = data.get('new_user_id')  # user being added
        call_type = data.get('call_type', 'voice')

        # Create ad-hoc group call (no group)
        gc = await self.create_adhoc_group_call(call_type)
        if not gc:
            return

        caller_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        caller_pic = self.user.profile_picture.url if self.user.profile_picture else None

        # Tell initiator the group call is ready
        await self.send(text_data=json.dumps({
            'type': 'call_upgraded',
            'group_call_id': gc.id,
            'call_type': call_type,
        }))

        # Tell existing peer to switch to group call
        await self.channel_layer.group_send(
            f'user_{existing_peer_id}',
            {
                'type': 'call_upgrade_notify',
                'group_call_id': gc.id,
                'call_type': call_type,
                'initiator_id': self.user.id,
                'initiator_name': caller_name,
            }
        )

        # Invite new user — they get a call notification
        await self.channel_layer.group_send(
            f'user_{new_user_id}',
            {
                'type': 'group_call_invite_notify',
                'group_call_id': gc.id,
                'call_type': call_type,
                'caller_id': self.user.id,
                'caller_name': caller_name,
                'caller_pic': caller_pic,
                'group_name': f'{caller_name}\'s call',
            }
        )

        # Send push/FCM to new user
        await database_sync_to_async(send_fcm_call_notification)(
            new_user_id, caller_name, call_type, caller_id=self.user.id
        )

    async def handle_group_call_invite(self, data):
        """Invite a new user to an existing group call"""
        gc_id = data.get('group_call_id')
        new_user_id = data.get('new_user_id')
        call_type = data.get('call_type', 'voice')

        caller_name = f"{self.user.first_name} {self.user.last_name}".strip() or self.user.username
        caller_pic = self.user.profile_picture.url if self.user.profile_picture else None
        group_name = await self.get_group_call_name(gc_id)

        # Send invite notification to new user
        await self.channel_layer.group_send(
            f'user_{new_user_id}',
            {
                'type': 'group_call_invite_notify',
                'group_call_id': gc_id,
                'call_type': call_type,
                'caller_id': self.user.id,
                'caller_name': caller_name,
                'caller_pic': caller_pic,
                'group_name': group_name,
            }
        )

        # Send push/FCM
        await database_sync_to_async(send_fcm_call_notification)(
            new_user_id, caller_name, call_type, caller_id=self.user.id
        )

    # Group call event forwarders
    async def call_upgrade_notify(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_upgrade_notify',
            'group_call_id': event['group_call_id'],
            'call_type': event['call_type'],
            'initiator_id': event['initiator_id'],
            'initiator_name': event['initiator_name'],
        }))

    async def group_call_invite_notify(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_invite',
            'group_call_id': event['group_call_id'],
            'call_type': event['call_type'],
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'caller_pic': event.get('caller_pic'),
            'group_name': event.get('group_name', 'Call'),
        }))

    async def group_call_notify(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_notify',
            'group_call_id': event['group_call_id'],
            'group_id': event['group_id'],
            'group_name': event['group_name'],
            'call_type': event['call_type'],
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'caller_pic': event.get('caller_pic'),
        }))

    async def group_call_ended_notify(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_ended',
            'group_call_id': event['group_call_id'],
            'group_id': event['group_id'],
        }))

    async def group_call_user_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_user_joined',
            'group_call_id': event['group_call_id'],
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'user_pic': event.get('user_pic'),
        }))

    async def group_call_offer_relay(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_offer',
            'group_call_id': event['group_call_id'],
            'from_user_id': event['from_user_id'],
            'from_user_name': event.get('from_user_name', ''),
            'from_user_pic': event.get('from_user_pic', ''),
            'sdp': event['sdp'],
        }))

    async def group_call_answer_relay(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_answer',
            'group_call_id': event['group_call_id'],
            'from_user_id': event['from_user_id'],
            'sdp': event['sdp'],
        }))

    async def group_call_ice_relay(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_ice',
            'group_call_id': event['group_call_id'],
            'from_user_id': event['from_user_id'],
            'candidate': event['candidate'],
        }))

    async def gc_screen_toggle_relay(self, event):
        await self.send(text_data=json.dumps({
            'type': 'gc_screen_toggle',
            'group_call_id': event['group_call_id'],
            'from_user_id': event['from_user_id'],
            'sharing': event['sharing'],
        }))

    async def group_call_user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'group_call_user_left',
            'group_call_id': event['group_call_id'],
            'user_id': event['user_id'],
        }))

    # Group call DB helpers
    @database_sync_to_async
    def create_group_call(self, group_id, call_type):
        try:
            group = Group.objects.get(id=group_id)
            gc = GroupCall.objects.create(group=group, initiator=self.user, call_type=call_type)
            GroupCallParticipant.objects.create(group_call=gc, user=self.user)
            return gc
        except Group.DoesNotExist:
            return None

    @database_sync_to_async
    def create_adhoc_group_call(self, call_type):
        """Create a group call without a group (ad-hoc, for adding users to 1-on-1 calls)"""
        gc = GroupCall.objects.create(group=None, initiator=self.user, call_type=call_type)
        GroupCallParticipant.objects.create(group_call=gc, user=self.user)
        return gc

    @database_sync_to_async
    def get_group_call_name(self, gc_id):
        try:
            gc = GroupCall.objects.get(id=gc_id)
            if gc.group:
                return gc.group.name
            initiator_name = f"{gc.initiator.first_name} {gc.initiator.last_name}".strip() or gc.initiator.username
            return f"{initiator_name}'s call"
        except GroupCall.DoesNotExist:
            return 'Call'

    @database_sync_to_async
    def add_group_call_participant(self, gc_id):
        try:
            gc = GroupCall.objects.get(id=gc_id, status='active')
            GroupCallParticipant.objects.get_or_create(group_call=gc, user=self.user)
        except GroupCall.DoesNotExist:
            pass

    @database_sync_to_async
    def get_group_call_participant_ids(self, gc_id):
        try:
            return list(GroupCallParticipant.objects.filter(
                group_call_id=gc_id, left_at__isnull=True
            ).values_list('user_id', flat=True))
        except:
            return []

    @database_sync_to_async
    def get_group_call_participants_info(self, gc_id):
        try:
            parts = GroupCallParticipant.objects.filter(
                group_call_id=gc_id, left_at__isnull=True
            ).select_related('user')
            return [{
                'id': p.user.id,
                'name': f"{p.user.first_name} {p.user.last_name}".strip() or p.user.username,
                'pic': p.user.profile_picture.url if p.user.profile_picture else None,
            } for p in parts]
        except:
            return []

    @database_sync_to_async
    def mark_group_call_left(self, gc_id):
        try:
            p = GroupCallParticipant.objects.get(group_call_id=gc_id, user=self.user, left_at__isnull=True)
            p.left_at = djtz.now()
            p.save()
        except GroupCallParticipant.DoesNotExist:
            pass

    @database_sync_to_async
    def get_active_participant_count(self, gc_id):
        return GroupCallParticipant.objects.filter(group_call_id=gc_id, left_at__isnull=True).count()

    @database_sync_to_async
    def end_group_call(self, gc_id):
        try:
            gc = GroupCall.objects.get(id=gc_id)
            gc.status = 'ended'
            gc.ended_at = djtz.now()
            gc.save()
        except GroupCall.DoesNotExist:
            pass

    @database_sync_to_async
    def get_group_member_ids(self, group_id):
        try:
            group = Group.objects.get(id=group_id)
            return list(group.members.values_list('id', flat=True))
        except Group.DoesNotExist:
            return []

    @database_sync_to_async
    def get_group_name(self, group_id):
        try:
            return Group.objects.get(id=group_id).name
        except Group.DoesNotExist:
            return 'Group'

    @database_sync_to_async
    def get_group_id_from_call(self, gc_id):
        try:
            gc = GroupCall.objects.get(id=gc_id)
            return gc.group_id
        except GroupCall.DoesNotExist:
            return None

    @database_sync_to_async
    def send_group_call_push(self, group_id, caller_name, group_name, call_type):
        try:
            group = Group.objects.get(id=group_id)
            call_label = 'Video' if call_type == 'video' else 'Voice'
            members = group.members.exclude(id=self.user.id)
            for member in members:
                print(f"[PUSH] Sending group call push to {member.username} (id={member.id})")
                send_push_notification(
                    member.id,
                    f'{group_name}',
                    f'{caller_name} started a {call_label} call',
                    url=f'/chat/?open_group={group_id}',
                    icon='/static/icons/icon-192x192.png',
                    tag=f'skychat-gcall-{group_id}'
                )
                # Also send via FCM
                send_fcm_call_notification(
                    member.id, caller_name, call_type,
                    caller_id=self.user.id
                )
        except Group.DoesNotExist:
            pass

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
    def send_dm_push(self, receiver_username, sender_name, body, icon):
        try:
            receiver = User.objects.get(username=receiver_username)
            send_push_notification(
                receiver.id,
                sender_name,
                body,
                url='/chat/',
                icon=icon or '/static/icons/icon-192x192.png',
                tag=f'skychat-dm-{self.user.id}'
            )
            # Also send via FCM
            send_fcm_notification(
                receiver.id,
                sender_name,
                body,
                data={'type': 'message', 'sender_id': str(self.user.id)}
            )
        except User.DoesNotExist:
            pass

    @database_sync_to_async
    def send_group_push(self, group_id, sender_name, body, icon):
        try:
            group = Group.objects.get(id=group_id)
            members = group.members.exclude(id=self.user.id)
            for member in members:
                send_push_notification(
                    member.id,
                    f'{sender_name} in {group.name}',
                    body,
                    url='/chat/',
                    icon=icon or '/static/icons/icon-192x192.png',
                    tag=f'skychat-group-{group_id}'
                )
                # Also send via FCM
                send_fcm_notification(
                    member.id,
                    f'{sender_name} in {group.name}',
                    body,
                    data={'type': 'message', 'group_id': str(group_id), 'sender_id': str(self.user.id)}
                )
        except Group.DoesNotExist:
            pass

    @database_sync_to_async
    def save_group_message(self, message, group_id, reply_to=None):
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
                call.started_at = djtz.now()
            call.save()
        except Call.DoesNotExist:
            pass

    @database_sync_to_async
    def end_call(self, call_id, duration):
        try:
            call = Call.objects.get(id=call_id)
            call.status = 'completed'
            call.ended_at = djtz.now()
            # Use client duration if provided, otherwise calculate from started_at
            if duration and duration > 0:
                call.duration = duration
            elif call.started_at:
                call.duration = int((call.ended_at - call.started_at).total_seconds())
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
    def get_contact_ids(self):
        """Get IDs of all users who have conversations with this user"""
        from django.db.models import Q
        convs = Conversation.objects.filter(
            Q(participant1=self.user) | Q(participant2=self.user)
        ).values_list('participant1_id', 'participant2_id')
        ids = set()
        for p1, p2 in convs:
            ids.add(p1 if p1 != self.user.id else p2)
        # Also add group members
        groups = Group.objects.filter(members=self.user).prefetch_related('members')
        for g in groups:
            for m in g.members.all():
                if m.id != self.user.id:
                    ids.add(m.id)
        return list(ids)

    @database_sync_to_async
    def get_group_member_ids(self, group_id):
        try:
            group = Group.objects.get(id=group_id)
            return list(group.members.values_list('id', flat=True))
        except Group.DoesNotExist:
            return []

    @database_sync_to_async
    def get_user_id_by_username(self, username):
        try:
            return User.objects.get(username=username).id
        except User.DoesNotExist:
            return None

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

    @database_sync_to_async
    def save_group_read_receipts(self, message_ids, group_id=None):
        """Save read receipts for multiple messages and return read counts"""
        read_counts = {}
        member_count = 0
        if group_id:
            try:
                group = Group.objects.get(id=group_id)
                member_count = group.members.count()
            except Group.DoesNotExist:
                pass
        for msg_id in message_ids:
            try:
                msg = Message.objects.get(id=msg_id)
                if msg.sender != self.user:
                    MessageReadReceipt.objects.get_or_create(
                        message=msg, user=self.user
                    )
                    read_counts[str(msg_id)] = msg.read_receipts.count()
            except Message.DoesNotExist:
                pass
        return {'read_counts': read_counts, 'member_count': member_count}
