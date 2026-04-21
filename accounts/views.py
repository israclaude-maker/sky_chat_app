from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken
from django.shortcuts import render
from django.db.models import Q
from django.utils import timezone
from datetime import timedelta

from accounts.models import CustomUser, PushSubscription, FCMDevice
from accounts.serializers import UserSerializer, RegisterSerializer, LoginSerializer
from chat.models import Conversation, Message, Group, GroupMembership, ConversationClear, Reaction, MessageReadReceipt
from chat.push import send_push_notification

class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    serializer_class = UserSerializer

    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def register(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            return Response({
                'user': UserSerializer(user).data,
                'message': 'Account created. Please wait for admin approval before you can login.'
            }, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def login(self, request):
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            username = serializer.validated_data.get('username')
            password = serializer.validated_data.get('password')

            # Check if user exists but is inactive
            try:
                check_user = CustomUser.objects.get(username=username)
                if not check_user.is_active:
                    return Response({'error': 'Your account is not yet activated. Please contact admin.'}, status=status.HTTP_403_FORBIDDEN)
            except CustomUser.DoesNotExist:
                pass

            user = authenticate(username=username, password=password)

            if user is not None:
                refresh = RefreshToken.for_user(user)
                return Response({
                    'user': UserSerializer(user).data,
                    'refresh': str(refresh),
                    'access': str(refresh.access_token),
                }, status=status.HTTP_200_OK)
            else:
                return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def me(self, request):
        return Response(UserSerializer(request.user).data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def all_users(self, request):
        users = CustomUser.objects.exclude(id=request.user.id)
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def conversations(self, request):
        """Get all conversations for current user (DMs + groups with messages)"""
        user = request.user
        conversations = Conversation.objects.filter(
            Q(participant1=user) | Q(participant2=user)
        ).order_by('-updated_at')
        
        result = []
        for conv in conversations:
            other_user = conv.participant2 if conv.participant1 == user else conv.participant1
            msgs = conv.messages
            # Filter by cleared_at
            clear = ConversationClear.objects.filter(user=user, conversation=conv).first()
            if clear:
                msgs = msgs.filter(timestamp__gte=clear.cleared_at)
            last_message = msgs.order_by('-timestamp').first()
            if not last_message:
                continue  # Skip empty/cleared conversations
            unread_count = msgs.filter(is_read=False).exclude(sender=user).count()
            result.append({
                'id': conv.id,
                'type': 'dm',
                'user': UserSerializer(other_user).data,
                'last_message': last_message.content if last_message else None,
                'last_message_time': last_message.timestamp.isoformat() if last_message else conv.updated_at.isoformat(),
                'updated_at': conv.updated_at.isoformat(),
                'unread_count': unread_count,
            })
        
        # Include groups with messages
        groups = Group.objects.filter(members=user)
        for group in groups:
            # Filter by join time or cleared time
            membership = GroupMembership.objects.filter(user=user, group=group).first()
            joined_at = membership.joined_at if membership else group.created_at
            visible_from = membership.cleared_at if membership and membership.cleared_at and membership.cleared_at > joined_at else joined_at
            last_message = group.messages.filter(timestamp__gte=visible_from).order_by('-timestamp').first()
            if not last_message:
                continue  # Only show groups with messages in Chats tab
            # Unread = messages after visible_from, not sent by me AND not read by me
            unread_count = group.messages.filter(timestamp__gte=visible_from).exclude(sender=user).exclude(
                read_receipts__user=user
            ).count()
            result.append({
                'id': group.id,
                'type': 'group',
                'group': {
                    'id': group.id,
                    'name': group.name,
                    'members': UserSerializer(group.members.all(), many=True).data,
                    'group_picture': group.group_picture.url if group.group_picture else None,
                },
                'last_message': last_message.content if last_message else None,
                'last_message_time': last_message.timestamp.isoformat() if last_message else group.updated_at.isoformat(),
                'updated_at': group.updated_at.isoformat(),
                'unread_count': unread_count,
            })
        
        # Sort by last_message_time descending (newest first)
        result.sort(key=lambda x: x['last_message_time'], reverse=True)
        return Response(result)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def start_conversation(self, request):
        """Create or get existing conversation with a user"""
        other_user_id = request.data.get('user_id')
        if not other_user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            other_user = CustomUser.objects.get(id=other_user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        
        # Sort participants by ID for consistent ordering
        participants = sorted([user.id, other_user.id])
        
        # Check if conversation already exists or create new
        conversation, created = Conversation.objects.get_or_create(
            participant1_id=participants[0],
            participant2_id=participants[1]
        )
        
        return Response({
            'id': conversation.id,
            'user': UserSerializer(other_user).data,
            'created': conversation.created_at.isoformat()
        })

    @action(detail=False, methods=['get'], url_path='messages/(?P<user_id>\d+)', permission_classes=[IsAuthenticated])
    def get_messages(self, request, user_id=None):
        """Get message history with a user"""
        try:
            other_user = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        participants = sorted([user.id, other_user.id])
        
        try:
            conversation = Conversation.objects.get(
                participant1_id=participants[0],
                participant2_id=participants[1]
            )
            messages = conversation.messages.select_related('sender', 'reply_to', 'reply_to__sender').order_by('timestamp')
            # Filter by cleared_at if user has cleared this chat
            clear = ConversationClear.objects.filter(user=user, conversation=conversation).first()
            if clear:
                messages = messages.filter(timestamp__gte=clear.cleared_at)
            messages = list(messages[:100000])
            result = []
            for msg in messages:
                # Get reactions
                reactions = msg.reactions.all()
                reaction_data = {}
                for r in reactions:
                    if r.emoji not in reaction_data:
                        reaction_data[r.emoji] = {'count': 0, 'users': []}
                    reaction_data[r.emoji]['count'] += 1
                    reaction_data[r.emoji]['users'].append(r.user.username)
                
                # Get reply data if this message is a reply
                reply_data = None
                if msg.reply_to:
                    reply_sender = f"{msg.reply_to.sender.first_name} {msg.reply_to.sender.last_name}".strip() or msg.reply_to.sender.username
                    reply_data = {
                        'text': msg.reply_to.content or '',
                        'sender': reply_sender
                    }
                
                result.append({
                    'id': msg.id,
                    'message': msg.content,
                    'message_type': msg.message_type,
                    'file_url': msg.file.url if msg.file else None,
                    'file_name': msg.file_name,
                    'file_size': msg.file_size,
                    'username': msg.sender.username,
                    'display_name': f"{msg.sender.first_name} {msg.sender.last_name}".strip() or msg.sender.username,
                    'timestamp': msg.timestamp.isoformat(),
                    'is_read': msg.is_read,
                    'read_at': msg.read_at.isoformat() if msg.read_at else None,
                    'is_edited': msg.is_edited,
                    'reactions': reaction_data,
                    'reply_data': reply_data
                })
            return Response(result)
        except Conversation.DoesNotExist:
            return Response([])

    # ================= GROUP ENDPOINTS =================

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def groups(self, request):
        """Get all groups for current user"""
        user = request.user
        groups = Group.objects.filter(members=user).order_by('-updated_at')
        
        result = []
        for group in groups:
            # Filter by join time or cleared time
            membership = GroupMembership.objects.filter(user=user, group=group).first()
            joined_at = membership.joined_at if membership else group.created_at
            visible_from = membership.cleared_at if membership and membership.cleared_at and membership.cleared_at > joined_at else joined_at
            last_message = group.messages.filter(timestamp__gte=visible_from).order_by('-timestamp').first()
            # Unread = messages after visible_from, not sent by me AND not read by me
            unread_count = group.messages.filter(timestamp__gte=visible_from).exclude(sender=user).exclude(
                read_receipts__user=user
            ).count()
            result.append({
                'id': group.id,
                'name': group.name,
                'description': group.description,
                'members': UserSerializer(group.members.all(), many=True).data,
                'admins': [a.id for a in group.admins.all()],
                'created_by': group.created_by.id,
                'last_message': last_message.content if last_message else None,
                'last_message_time': last_message.timestamp.isoformat() if last_message else None,
                'created_at': group.created_at.isoformat(),
                'updated_at': group.updated_at.isoformat(),
                'unread_count': unread_count,
            })
        return Response(result)

    @action(detail=False, methods=['post'], url_path='groups/create', permission_classes=[IsAuthenticated])
    def create_group(self, request):
        """Create a new group"""
        name = request.data.get('name')
        member_ids = request.data.get('members', [])
        description = request.data.get('description', '')
        
        if not name:
            return Response({'error': 'Group name is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        user = request.user
        
        # Create group
        group = Group.objects.create(
            name=name,
            description=description,
            created_by=user
        )
        
        # Add creator as member and admin
        group.members.add(user)
        group.admins.add(user)
        GroupMembership.objects.get_or_create(user=user, group=group)
        
        # Add other members
        for member_id in member_ids:
            try:
                member = CustomUser.objects.get(id=member_id)
                group.members.add(member)
                GroupMembership.objects.get_or_create(user=member, group=group)
            except CustomUser.DoesNotExist:
                pass
        
        return Response({
            'id': group.id,
            'name': group.name,
            'description': group.description,
            'members': UserSerializer(group.members.all(), many=True).data,
            'created_at': group.created_at.isoformat()
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/add_member', permission_classes=[IsAuthenticated])
    def add_group_member(self, request, group_id=None):
        """Add a member to a group"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.admins.all():
            return Response({'error': 'Only admins can add members'}, status=status.HTTP_403_FORBIDDEN)
        
        member_id = request.data.get('user_id')
        try:
            member = CustomUser.objects.get(id=member_id)
            group.members.add(member)
            GroupMembership.objects.get_or_create(user=member, group=group)
            return Response({'message': 'Member added successfully'})
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/leave', permission_classes=[IsAuthenticated])
    def leave_group(self, request, group_id=None):
        """Leave a group"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        if user not in group.members.all():
            return Response({'error': 'You are not a member of this group'}, status=status.HTTP_400_BAD_REQUEST)
        
        group.members.remove(user)
        GroupMembership.objects.filter(user=user, group=group).delete()
        if user in group.admins.all():
            group.admins.remove(user)
        
        # Create system message
        Message.objects.create(
            group=group,
            sender=user,
            content=f'{user.first_name or user.username} left the group',
            message_type='text'
        )
        
        return Response({'message': 'Left group successfully'})

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/delete_group', permission_classes=[IsAuthenticated])
    def delete_group(self, request, group_id=None):
        """Delete a group (admin only)"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.admins.all():
            return Response({'error': 'Only admins can delete a group'}, status=status.HTTP_403_FORBIDDEN)
        
        group_name = group.name
        # Delete all messages, memberships, and the group itself
        Message.objects.filter(group=group).delete()
        GroupMembership.objects.filter(group=group).delete()
        group.delete()
        
        return Response({'message': f'Group "{group_name}" deleted successfully'})

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/remove_member', permission_classes=[IsAuthenticated])
    def remove_group_member(self, request, group_id=None):
        """Remove a member from a group (admin only)"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.admins.all():
            return Response({'error': 'Only admins can remove members'}, status=status.HTTP_403_FORBIDDEN)
        
        member_id = request.data.get('user_id')
        try:
            member = CustomUser.objects.get(id=member_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if member not in group.members.all():
            return Response({'error': 'User is not a member'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Cannot remove yourself via this endpoint
        if member == request.user:
            return Response({'error': 'Use leave endpoint to leave'}, status=status.HTTP_400_BAD_REQUEST)
        
        group.members.remove(member)
        GroupMembership.objects.filter(user=member, group=group).delete()
        if member in group.admins.all():
            group.admins.remove(member)
        
        admin_name = request.user.first_name or request.user.username
        member_name = member.first_name or member.username
        Message.objects.create(
            group=group,
            sender=request.user,
            content=f'{admin_name} removed {member_name}',
            message_type='text'
        )
        
        return Response({
            'message': 'Member removed',
            'members': UserSerializer(group.members.all(), many=True).data,
            'admins': [a.id for a in group.admins.all()]
        })

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/make_admin', permission_classes=[IsAuthenticated])
    def make_group_admin(self, request, group_id=None):
        """Make a member an admin"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.admins.all():
            return Response({'error': 'Only admins can promote members'}, status=status.HTTP_403_FORBIDDEN)
        
        member_id = request.data.get('user_id')
        try:
            member = CustomUser.objects.get(id=member_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if member not in group.members.all():
            return Response({'error': 'User is not a member'}, status=status.HTTP_400_BAD_REQUEST)
        
        group.admins.add(member)
        return Response({
            'message': 'Admin added',
            'admins': [a.id for a in group.admins.all()]
        })

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/remove_admin', permission_classes=[IsAuthenticated])
    def remove_group_admin(self, request, group_id=None):
        """Remove admin status from a member"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.admins.all():
            return Response({'error': 'Only admins can demote admins'}, status=status.HTTP_403_FORBIDDEN)
        
        member_id = request.data.get('user_id')
        try:
            member = CustomUser.objects.get(id=member_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        group.admins.remove(member)
        return Response({
            'message': 'Admin removed',
            'admins': [a.id for a in group.admins.all()]
        })

    @action(detail=False, methods=['get'], url_path='groups/(?P<group_id>[^/.]+)/active_call', permission_classes=[IsAuthenticated])
    def group_active_call(self, request, group_id=None):
        """Check if there is an active group call"""
        from calls.models import GroupCall
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        if request.user not in group.members.all():
            return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)
        from calls.models import GroupCallParticipant
        from django.utils import timezone as tz
        active_call = GroupCall.objects.filter(group=group, status='active').first()
        if active_call:
            # Auto-end calls older than 2 hours (stale safety net)
            if active_call.started_at and (tz.now() - active_call.started_at).total_seconds() > 7200:
                active_call.status = 'ended'
                active_call.ended_at = tz.now()
                active_call.save(update_fields=['status', 'ended_at'])
                return Response({'active': False})
            # Only report as active if there are actual active participants
            active_count = GroupCallParticipant.objects.filter(
                group_call=active_call, left_at__isnull=True
            ).count()
            if active_count > 0:
                return Response({
                    'active': True,
                    'group_call_id': active_call.id,
                    'call_type': active_call.call_type,
                    'caller_name': f"{active_call.initiator.first_name} {active_call.initiator.last_name}".strip() or active_call.initiator.username,
                    'caller_pic': active_call.initiator.profile_picture.url if active_call.initiator.profile_picture else None,
                    'group_name': group.name,
                    'group_id': group.id,
                    'participant_count': active_count,
                })
            else:
                # No active participants — mark call as ended (stale cleanup)
                active_call.status = 'ended'
                active_call.ended_at = tz.now()
                active_call.save(update_fields=['status', 'ended_at'])
        return Response({'active': False})

    @action(detail=False, methods=['get'], url_path='groups/(?P<group_id>[^/.]+)/info', permission_classes=[IsAuthenticated])
    def group_info(self, request, group_id=None):
        """Get detailed group info"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.members.all():
            return Response({'error': 'You are not a member'}, status=status.HTTP_403_FORBIDDEN)
        
        members_data = []
        for m in group.members.all():
            members_data.append({
                'id': m.id,
                'username': m.username,
                'first_name': m.first_name,
                'last_name': m.last_name,
                'profile_picture': m.profile_picture.url if m.profile_picture else None,
                'is_online': m.is_online,
                'last_seen': m.last_seen.isoformat() if m.last_seen else None,
                'is_admin': m in group.admins.all()
            })
        
        return Response({
            'id': group.id,
            'name': group.name,
            'description': group.description,
            'group_picture': group.group_picture.url if group.group_picture else None,
            'created_by': group.created_by.id,
            'members': members_data,
            'admins': [a.id for a in group.admins.all()],
            'created_at': group.created_at.isoformat(),
            'member_count': group.members.count()
        })

    @action(detail=False, methods=['post'], url_path='groups/(?P<group_id>[^/.]+)/mark_read', permission_classes=[IsAuthenticated])
    def mark_group_read(self, request, group_id=None):
        """Mark all unread group messages as read by current user"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        # Get all messages in group not sent by this user that don't have a read receipt
        unread_msgs = Message.objects.filter(group=group).exclude(sender=user).exclude(
            read_receipts__user=user
        )
        
        receipts = []
        for msg in unread_msgs:
            receipt, created = MessageReadReceipt.objects.get_or_create(
                message=msg, user=user
            )
            if created:
                receipts.append(receipt)
        
        # Also update the legacy is_read field if all members have read
        member_count = group.members.count()
        for msg in unread_msgs:
            read_count = msg.read_receipts.count()
            if read_count >= member_count - 1:  # -1 for sender
                msg.is_read = True
                msg.read_at = timezone.now()
                msg.save(update_fields=['is_read', 'read_at'])
        
        return Response({'marked_read': len(receipts)})

    @action(detail=False, methods=['get'], url_path='groups/messages/(?P<message_id>[^/.]+)/info', permission_classes=[IsAuthenticated])
    def group_message_info(self, request, message_id=None):
        """Get message info with per-user read/delivered status for group messages"""
        try:
            msg = Message.objects.select_related('group', 'sender').get(id=message_id)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if not msg.group:
            # Direct message - return simple info
            return Response({
                'id': msg.id,
                'content': msg.content,
                'sent_at': msg.timestamp.isoformat(),
                'delivered_at': msg.delivered_at.isoformat() if msg.delivered_at else None,
                'read_at': msg.read_at.isoformat() if msg.read_at else None,
                'is_read': msg.is_read,
                'read_by': [],
                'delivered_to': []
            })
        
        group = msg.group
        members = group.members.exclude(id=msg.sender.id)
        
        read_receipts = {r.user_id: r.read_at for r in msg.read_receipts.select_related('user').all()}
        
        read_by = []
        delivered_to = []
        
        for member in members:
            member_data = {
                'id': member.id,
                'username': member.username,
                'first_name': member.first_name,
                'last_name': member.last_name,
                'profile_picture': member.profile_picture.url if member.profile_picture else None,
            }
            if member.id in read_receipts:
                member_data['read_at'] = read_receipts[member.id].isoformat()
                read_by.append(member_data)
            else:
                member_data['delivered_at'] = msg.timestamp.isoformat()
                delivered_to.append(member_data)
        
        return Response({
            'id': msg.id,
            'content': msg.content,
            'message_type': msg.message_type,
            'sent_at': msg.timestamp.isoformat(),
            'sender': UserSerializer(msg.sender).data,
            'read_by': read_by,
            'delivered_to': delivered_to,
            'total_members': members.count(),
            'read_count': len(read_by),
        })

    @action(detail=False, methods=['get'], url_path='groups/(?P<group_id>[^/.]+)/messages', permission_classes=[IsAuthenticated])
    def group_messages(self, request, group_id=None):
        """Get message history for a group"""
        try:
            group = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if request.user not in group.members.all():
            return Response({'error': 'You are not a member of this group'}, status=status.HTTP_403_FORBIDDEN)
        
        # Only show messages from after the user joined or last cleared
        membership = GroupMembership.objects.filter(user=request.user, group=group).first()
        joined_at = membership.joined_at if membership else group.created_at
        visible_from = membership.cleared_at if membership and membership.cleared_at and membership.cleared_at > joined_at else joined_at
        
        messages_qs = Message.objects.filter(group=group, timestamp__gte=visible_from).select_related('sender', 'reply_to', 'reply_to__sender').order_by('timestamp')
        messages = list(messages_qs[:100000])
        result = []
        member_count = group.members.count()
        for msg in messages:
            # Get reactions
            reactions = msg.reactions.all()
            reaction_data = {}
            for r in reactions:
                if r.emoji not in reaction_data:
                    reaction_data[r.emoji] = {'count': 0, 'users': []}
                reaction_data[r.emoji]['count'] += 1
                reaction_data[r.emoji]['users'].append(r.user.username)
            
            # Read receipt count for group ticks
            read_count = msg.read_receipts.count() if msg.sender == request.user else 0
            all_read = read_count >= (member_count - 1) if msg.sender == request.user else False
            
            # Reply data
            reply_data = None
            if msg.reply_to:
                reply_sender_name = f"{msg.reply_to.sender.first_name} {msg.reply_to.sender.last_name}".strip() or msg.reply_to.sender.username
                reply_data = {
                    'text': msg.reply_to.content or '',
                    'sender': reply_sender_name
                }
            
            result.append({
                'id': msg.id,
                'message': msg.content,
                'message_type': msg.message_type,
                'file_url': msg.file.url if msg.file else None,
                'file_name': msg.file_name,
                'file_size': msg.file_size,
                'username': msg.sender.username,
                'display_name': f"{msg.sender.first_name} {msg.sender.last_name}".strip() or msg.sender.username,
                'profile_picture': msg.sender.profile_picture.url if msg.sender.profile_picture else None,
                'timestamp': msg.timestamp.isoformat(),
                'is_read': all_read,
                'read_at': msg.read_at.isoformat() if msg.read_at else None,
                'read_count': read_count,
                'is_edited': msg.is_edited,
                'reactions': reaction_data,
                'reply_data': reply_data
            })
        return Response(result)

    # ================= MESSAGE ENDPOINTS =================

    @action(detail=False, methods=['post'], url_path='messages/upload', permission_classes=[IsAuthenticated])
    def upload_file(self, request):
        """Upload a file message (DM or Group)"""
        file = request.FILES.get('file')
        receiver_id = request.data.get('receiver_id')
        group_id = request.data.get('group_id')
        caption = request.data.get('caption', '')
        message_type = request.data.get('message_type', 'file')
        
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not receiver_id and not group_id:
            return Response({'error': 'receiver_id or group_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        user = request.user
        
        # Determine message type from file extension
        ext = file.name.lower().split('.')[-1] if '.' in file.name else ''
        if ext in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
            message_type = 'image'
        elif ext in ['mp4', 'webm', 'mov', 'avi']:
            message_type = 'video'
        elif ext in ['mp3', 'wav', 'ogg', 'm4a']:
            message_type = 'audio'
        
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        
        if group_id:
            # Group file upload
            try:
                group = Group.objects.get(id=group_id)
            except Group.DoesNotExist:
                return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
            
            msg = Message.objects.create(
                group=group,
                sender=user,
                message_type=message_type,
                file=file,
                file_name=file.name,
                file_size=file.size,
                content=caption or file.name
            )
            
            # Broadcast to all group members via WebSocket
            msg_data = {
                'type': 'new_message_notify',
                'message_id': msg.id,
                'message': msg.content,
                'message_type': msg.message_type,
                'file_url': msg.file.url,
                'file_name': msg.file_name,
                'file_size': msg.file_size,
                'sender_id': user.id,
                'username': user.username,
                'display_name': user.first_name or user.username,
                'profile_picture': user.profile_picture.url if user.profile_picture else None,
                'group_id': group.id,
                'group_name': group.name,
                'timestamp': msg.timestamp.isoformat(),
                'status': 'sent',
            }
            for member in group.members.all():
                async_to_sync(channel_layer.group_send)(f'user_{member.id}', msg_data)
        else:
            # DM file upload
            try:
                receiver = CustomUser.objects.get(id=receiver_id)
            except CustomUser.DoesNotExist:
                return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
            
            participants = sorted([user.id, receiver.id])
            conversation, _ = Conversation.objects.get_or_create(
                participant1_id=participants[0],
                participant2_id=participants[1]
            )
            
            msg = Message.objects.create(
                conversation=conversation,
                sender=user,
                message_type=message_type,
                file=file,
                file_name=file.name,
                file_size=file.size,
                content=caption or file.name
            )
            
            # Broadcast to both users via WebSocket
            msg_data = {
                'type': 'file_message',
                'id': msg.id,
                'message_id': msg.id,
                'message': msg.content,
                'message_type': msg.message_type,
                'file_url': msg.file.url,
                'file_name': msg.file_name,
                'file_size': msg.file_size,
                'sender_id': user.id,
                'username': user.username,
                'display_name': user.first_name or user.username,
                'timestamp': msg.timestamp.isoformat(),
                'status': 'sent',
            }
            async_to_sync(channel_layer.group_send)(f'user_{receiver.id}', msg_data)
            async_to_sync(channel_layer.group_send)(f'user_{user.id}', msg_data)
        
        return Response({
            'id': msg.id,
            'message_type': msg.message_type,
            'file_url': msg.file.url,
            'file_name': msg.file_name,
            'file_size': msg.file_size,
            'timestamp': msg.timestamp.isoformat(),
            'sender': UserSerializer(user).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='messages/voice', permission_classes=[IsAuthenticated])
    def upload_voice(self, request):
        """Upload a voice message"""
        file = request.FILES.get('file')
        receiver_id = request.data.get('receiver_id')
        duration = request.data.get('duration', 0)
        
        if not file:
            return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not receiver_id:
            return Response({'error': 'receiver_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            receiver = CustomUser.objects.get(id=receiver_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        participants = sorted([user.id, receiver.id])
        
        conversation, _ = Conversation.objects.get_or_create(
            participant1_id=participants[0],
            participant2_id=participants[1]
        )
        
        import time
        filename = f'voice_{int(time.time())}.webm'
        
        msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            message_type='voice',
            file=file,
            file_name=filename,
            file_size=file.size,
            content=f'Voice message ({duration}s)'
        )
        
        # Broadcast via WebSocket
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        
        msg_data = {
            'type': 'voice_message',
            'id': msg.id,
            'message_id': msg.id,
            'message': msg.content,
            'message_type': 'voice',
            'file_url': msg.file.url,
            'file_name': msg.file_name,
            'duration': duration,
            'sender_id': user.id,
            'username': user.username,
            'display_name': user.first_name or user.username,
            'timestamp': msg.timestamp.isoformat(),
            'status': 'sent'
        }
        
        async_to_sync(channel_layer.group_send)(f'user_{receiver.id}', msg_data)
        async_to_sync(channel_layer.group_send)(f'user_{user.id}', msg_data)
        
        return Response({
            'id': msg.id,
            'message_type': 'voice',
            'file_url': msg.file.url,
            'duration': duration,
            'timestamp': msg.timestamp.isoformat(),
            'sender': UserSerializer(user).data
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='messages/(?P<message_id>\d+)/react', permission_classes=[IsAuthenticated])
    def react_to_message(self, request, message_id=None):
        """Add or update reaction to a message"""
        emoji = request.data.get('emoji')
        
        if not emoji:
            return Response({'error': 'emoji is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            message = Message.objects.get(id=message_id)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Update or create reaction
        reaction, created = Reaction.objects.update_or_create(
            message=message,
            user=request.user,
            defaults={'emoji': emoji}
        )
        
        # Get all reactions for this message
        reactions = message.reactions.all()
        reaction_data = {}
        for r in reactions:
            if r.emoji not in reaction_data:
                reaction_data[r.emoji] = {'count': 0, 'users': []}
            reaction_data[r.emoji]['count'] += 1
            reaction_data[r.emoji]['users'].append(r.user.username)
        
        return Response({
            'message_id': message_id,
            'reactions': reaction_data
        })

    @action(detail=False, methods=['delete'], url_path='messages/(?P<message_id>\d+)/unreact', permission_classes=[IsAuthenticated])
    def remove_reaction(self, request, message_id=None):
        """Remove reaction from a message"""
        try:
            message = Message.objects.get(id=message_id)
            Reaction.objects.filter(message=message, user=request.user).delete()
            return Response({'message': 'Reaction removed'})
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'], url_path='messages/(?P<message_id>\d+)/read', permission_classes=[IsAuthenticated])
    def mark_message_read(self, request, message_id=None):
        """Mark a message as read"""
        try:
            message = Message.objects.get(id=message_id)
            if message.sender != request.user and not message.is_read:
                message.is_read = True
                message.read_at = timezone.now()
                message.save()
            return Response({
                'message_id': message_id,
                'is_read': message.is_read,
                'read_at': message.read_at.isoformat() if message.read_at else None
            })
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'], url_path=r'messages/(?P<message_id>\d+)/edit', permission_classes=[IsAuthenticated])
    def edit_message(self, request, message_id=None):
        """Edit a message (only by sender, within 3 hours)"""
        try:
            message = Message.objects.get(id=message_id)
            
            # Only sender can edit
            if message.sender != request.user:
                return Response({'error': 'You can only edit your own messages'}, status=status.HTTP_403_FORBIDDEN)
            
            # Only text messages can be edited
            if message.message_type != 'text':
                return Response({'error': 'Only text messages can be edited'}, status=status.HTTP_400_BAD_REQUEST)
            
            # 3-hour time limit
            if timezone.now() - message.timestamp > timedelta(hours=3):
                return Response({'error': 'Messages can only be edited within 3 hours'}, status=status.HTTP_400_BAD_REQUEST)
            
            new_content = request.data.get('message', '').strip()
            if not new_content:
                return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            
            message.content = new_content
            message.is_edited = True
            message.save()
            
            return Response({
                'success': True,
                'message_id': message_id,
                'content': message.content,
                'is_edited': True,
                'group_id': message.group_id,
            })
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'], url_path='messages/mark_read', permission_classes=[IsAuthenticated])
    def mark_conversation_read(self, request):
        """Mark all messages in a conversation as read"""
        user_id = request.data.get('user_id')
        
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            other_user = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        participants = sorted([request.user.id, other_user.id])
        
        try:
            conversation = Conversation.objects.get(
                participant1_id=participants[0],
                participant2_id=participants[1]
            )
            # Mark all unread messages from other user as read
            now = timezone.now()
            updated = conversation.messages.filter(
                sender=other_user,
                is_read=False
            ).update(is_read=True, read_at=now)
            
            return Response({'marked_read': updated})
        except Conversation.DoesNotExist:
            return Response({'marked_read': 0})

    @action(detail=False, methods=['get'], url_path='messages/(?P<message_id>\d+)/info', permission_classes=[IsAuthenticated])
    def message_info(self, request, message_id=None):
        """Get message info including delivery and read status"""
        try:
            message = Message.objects.get(id=message_id)
            
            # Get reactions
            reactions = message.reactions.all()
            reaction_data = {}
            for r in reactions:
                if r.emoji not in reaction_data:
                    reaction_data[r.emoji] = {'count': 0, 'users': []}
                reaction_data[r.emoji]['count'] += 1
                reaction_data[r.emoji]['users'].append(r.user.username)
            
            return Response({
                'id': message.id,
                'content': message.content,
                'message_type': message.message_type,
                'file_url': message.file.url if message.file else None,
                'file_name': message.file_name,
                'sender': UserSerializer(message.sender).data,
                'timestamp': message.timestamp.isoformat(),
                'delivered_at': message.delivered_at.isoformat() if message.delivered_at else None,
                'read_at': message.read_at.isoformat() if message.read_at else None,
                'is_read': message.is_read,
                'reactions': reaction_data
            })
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    # ================= CALL HISTORY =================

    @action(detail=False, methods=['get'], url_path='call_history', permission_classes=[IsAuthenticated])
    def call_history(self, request):
        """Get call history for current user - both made and received calls, plus group calls"""
        from calls.models import Call, GroupCall, GroupCallParticipant
        
        user = request.user
        
        # 1:1 calls
        calls = Call.objects.filter(
            Q(caller=user) | Q(receiver=user)
        ).order_by('-created_at')[:50]
        
        result = []
        for call in calls:
            is_outgoing = call.caller == user
            other_user = call.receiver if is_outgoing else call.caller
            
            result.append({
                'id': call.id,
                'type': 'dm',
                'is_outgoing': is_outgoing,
                'call_type': call.call_type,
                'status': call.status,
                'other_user': {
                    'id': other_user.id,
                    'username': other_user.username,
                    'first_name': other_user.first_name,
                    'last_name': other_user.last_name,
                    'profile_picture': other_user.profile_picture.url if other_user.profile_picture else None,
                },
                'duration': call.duration,
                'created_at': call.created_at.isoformat(),
                'started_at': call.started_at.isoformat() if call.started_at else None,
                'ended_at': call.ended_at.isoformat() if call.ended_at else None,
            })
        
        # Group calls the user participated in
        gc_participant_ids = GroupCallParticipant.objects.filter(
            user=user
        ).values_list('group_call_id', flat=True)
        
        group_calls = GroupCall.objects.filter(
            id__in=gc_participant_ids
        ).select_related('group', 'initiator').order_by('-started_at')[:50]
        
        for gc in group_calls:
            participants = list(
                GroupCallParticipant.objects.filter(group_call=gc)
                .select_related('user')
                .order_by('joined_at')
            )
            participant_list = []
            for p in participants:
                pname = f"{p.user.first_name} {p.user.last_name}".strip() or p.user.username
                participant_list.append({
                    'id': p.user.id,
                    'name': pname,
                    'profile_picture': p.user.profile_picture.url if p.user.profile_picture else None,
                })
            
            duration = 0
            if gc.ended_at and gc.started_at:
                duration = int((gc.ended_at - gc.started_at).total_seconds())
            
            group_data = None
            if gc.group:
                group_data = {
                    'id': gc.group.id,
                    'name': gc.group.name,
                    'group_picture': gc.group.group_picture.url if gc.group.group_picture else None,
                }
            
            result.append({
                'id': gc.id,
                'type': 'group',
                'call_type': gc.call_type,
                'status': gc.status,
                'group': group_data,
                'initiator': {
                    'id': gc.initiator.id,
                    'name': f"{gc.initiator.first_name} {gc.initiator.last_name}".strip() or gc.initiator.username,
                },
                'participants': participant_list,
                'duration': duration,
                'created_at': gc.started_at.isoformat(),
                'started_at': gc.started_at.isoformat(),
                'ended_at': gc.ended_at.isoformat() if gc.ended_at else None,
            })
        
        # Sort combined list by created_at descending
        result.sort(key=lambda x: x['created_at'], reverse=True)
        
        return Response(result[:50])

    # ================= PROFILE UPDATE =================

    @action(detail=False, methods=['get', 'post', 'put'], url_path='profile', permission_classes=[IsAuthenticated])
    def profile(self, request):
        """Get or update current user's profile"""
        user = request.user
        
        if request.method == 'GET':
            return Response({
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'profile_picture': user.profile_picture.url if user.profile_picture else None,
                'is_online': user.is_online,
                'last_seen': user.last_seen.isoformat() if user.last_seen else None,
                'created_at': user.created_at.isoformat() if user.created_at else None,
            })
        
        # POST/PUT - update profile
        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        email = request.data.get('email')
        
        if first_name is not None:
            user.first_name = first_name
        if last_name is not None:
            user.last_name = last_name
        if email is not None:
            user.email = email
        
        user.save()
        
        return Response({
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'profile_picture': user.profile_picture.url if user.profile_picture else None,
            'message': 'Profile updated successfully'
        })

    @action(detail=False, methods=['post'], url_path='profile_picture', permission_classes=[IsAuthenticated])
    def update_profile_picture(self, request):
        """Update profile picture"""
        user = request.user
        
        if 'picture' not in request.FILES:
            return Response({'error': 'No picture file provided'}, status=status.HTTP_400_BAD_REQUEST)
        
        picture = request.FILES['picture']
        
        # Validate file size (max 5MB)
        if picture.size > 5 * 1024 * 1024:
            return Response({'error': 'File size must be less than 5MB'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if picture.content_type not in allowed_types:
            return Response({'error': 'Invalid file type. Use JPEG, PNG, GIF or WebP'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Delete old picture if exists
        if user.profile_picture:
            user.profile_picture.delete(save=False)
        
        user.profile_picture = picture
        user.save()
        
        return Response({
            'profile_picture': user.profile_picture.url,
            'message': 'Profile picture updated successfully'
        })

    @action(detail=False, methods=['post'], url_path='remove_picture', permission_classes=[IsAuthenticated])
    def remove_profile_picture(self, request):
        """Remove profile picture - revert to default letter avatar"""
        try:
            user = request.user
            if user.profile_picture:
                try:
                    user.profile_picture.delete(save=False)
                except Exception:
                    pass  # File already deleted or doesn't exist
                user.profile_picture = None
                user.save()
            return Response({'success': True})
        except Exception as e:
            return Response({'success': False, 'error': str(e)}, status=400)

    @action(detail=False, methods=['post'], url_path='delete_conversation/(?P<user_id>[^/.]+)', permission_classes=[IsAuthenticated])
    def delete_conversation(self, request, user_id=None):
        """Clear chat for current user only (not for other user)"""
        me = request.user
        try:
            other = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        participants = sorted([me.id, other.id])
        try:
            conv = Conversation.objects.get(participant1_id=participants[0], participant2_id=participants[1])
            ConversationClear.objects.update_or_create(
                user=me, conversation=conv,
                defaults={'cleared_at': timezone.now()}
            )
        except Conversation.DoesNotExist:
            pass
        return Response({'success': True})

    @action(detail=False, methods=['post'], url_path='clear_group/(?P<group_id>[^/.]+)', permission_classes=[IsAuthenticated])
    def clear_group_chat(self, request, group_id=None):
        """Clear group chat for current user only"""
        try:
            grp = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        if request.user not in grp.members.all():
            return Response({'error': 'You are not a member'}, status=status.HTTP_403_FORBIDDEN)
        membership = GroupMembership.objects.filter(user=request.user, group=grp).first()
        if membership:
            membership.cleared_at = timezone.now()
            membership.save()
        return Response({'success': True})

    @action(detail=False, methods=['get'], url_path='contact_media/(?P<user_id>[^/.]+)', permission_classes=[IsAuthenticated])
    def contact_media(self, request, user_id=None):
        """Get all media files shared in a conversation with a user"""
        me = request.user
        try:
            other = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        participants = sorted([me.id, other.id])
        try:
            conv = Conversation.objects.get(participant1_id=participants[0], participant2_id=participants[1])
        except Conversation.DoesNotExist:
            return Response([])
        msgs = Message.objects.filter(
            conversation=conv,
            message_type__in=['image', 'video', 'audio', 'file', 'voice']
        ).order_by('-timestamp')[:100]
        result = []
        for m in msgs:
            result.append({
                'id': m.id,
                'type': m.message_type,
                'url': m.file.url if m.file else None,
                'name': m.file_name,
                'size': m.file_size,
                'timestamp': m.timestamp.isoformat(),
                'sender_id': m.sender_id,
            })
        return Response(result)

    @action(detail=False, methods=['get'], url_path='group_media/(?P<group_id>[^/.]+)', permission_classes=[IsAuthenticated])
    def group_media(self, request, group_id=None):
        """Get all media files shared in a group"""
        try:
            grp = Group.objects.get(id=group_id)
        except Group.DoesNotExist:
            return Response({'error': 'Group not found'}, status=status.HTTP_404_NOT_FOUND)
        if request.user not in grp.members.all():
            return Response({'error': 'Not a member'}, status=status.HTTP_403_FORBIDDEN)
        msgs = Message.objects.filter(
            group=grp,
            message_type__in=['image', 'video', 'audio', 'file', 'voice']
        ).order_by('-timestamp')[:100]
        result = []
        for m in msgs:
            result.append({
                'id': m.id,
                'type': m.message_type,
                'url': m.file.url if m.file else None,
                'name': m.file_name,
                'size': m.file_size,
                'timestamp': m.timestamp.isoformat(),
                'sender_id': m.sender_id,
            })
        return Response(result)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def vapid_public_key(self, request):
        from django.conf import settings
        return Response({'public_key': settings.VAPID_PUBLIC_KEY})

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def push_subscribe(self, request):
        endpoint = request.data.get('endpoint')
        p256dh = request.data.get('p256dh')
        auth = request.data.get('auth')
        if not endpoint or not p256dh or not auth:
            return Response({'error': 'Missing fields'}, status=status.HTTP_400_BAD_REQUEST)
        sub, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint,
            defaults={'user': request.user, 'p256dh': p256dh, 'auth': auth}
        )
        return Response({'status': 'ok', 'created': created})

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def push_unsubscribe(self, request):
        endpoint = request.data.get('endpoint')
        if endpoint:
            PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({'status': 'ok'})

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def fcm_register(self, request):
        """Register or update an FCM device token."""
        token = request.data.get('token')
        device_type = request.data.get('device_type', 'android')
        if not token:
            return Response({'error': 'Missing token'}, status=status.HTTP_400_BAD_REQUEST)
        # Deactivate this token for any other user (device switched accounts)
        FCMDevice.objects.filter(registration_id=token).exclude(user=request.user).delete()
        device, created = FCMDevice.objects.update_or_create(
            registration_id=token,
            defaults={'user': request.user, 'device_type': device_type, 'active': True}
        )
        return Response({'status': 'ok', 'created': created})

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated])
    def fcm_unregister(self, request):
        """Remove an FCM device token."""
        token = request.data.get('token')
        if token:
            FCMDevice.objects.filter(user=request.user, registration_id=token).delete()
        return Response({'status': 'ok'})


def index(request):
    return render(request, 'accounts/index.html')


class MessageViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['post'], url_path='upload')
    def upload_file(self, request):
        """Upload file message"""
        file = request.FILES.get('file')
        receiver_id = request.data.get('receiver_id')
        
        if not file or not receiver_id:
            return Response({'error': 'File and receiver_id required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            receiver = CustomUser.objects.get(id=receiver_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        participants = sorted([user.id, receiver.id])
        conversation, _ = Conversation.objects.get_or_create(
            participant1_id=participants[0],
            participant2_id=participants[1]
        )
        
        # Determine message type
        ext = file.name.split('.')[-1].lower()
        if ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']:
            msg_type = 'image'
        elif ext in ['mp4', 'webm', 'mov', 'avi', 'mkv']:
            msg_type = 'video'
        elif ext in ['mp3', 'wav', 'ogg', 'm4a']:
            msg_type = 'audio'
        else:
            msg_type = 'file'
        
        msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            message_type=msg_type,
            file=file,
            file_name=file.name,
            file_size=file.size
        )

        # Send push notification to receiver
        sender_name = f"{user.first_name} {user.last_name}".strip() or user.username
        file_label = {'image': '📷 Photo', 'video': '🎥 Video', 'audio': '🎵 Audio'}.get(msg_type, '📎 ' + file.name)
        sender_pic = user.profile_picture.url if user.profile_picture else None
        send_push_notification(
            receiver.id, sender_name, file_label,
            url='/chat/', icon=sender_pic, tag=f'skychat-dm-{user.id}'
        )
        
        return Response({
            'id': msg.id,
            'message_type': msg_type,
            'file_url': msg.file.url,
            'file_name': msg.file_name,
            'file_size': msg.file_size,
            'timestamp': msg.timestamp.isoformat()
        })
    
    @action(detail=False, methods=['post'], url_path='voice')
    def upload_voice(self, request):
        """Upload voice message"""
        file = request.FILES.get('file')
        receiver_id = request.data.get('receiver_id')
        duration = request.data.get('duration', 0)
        
        if not file or not receiver_id:
            return Response({'error': 'File and receiver_id required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            receiver = CustomUser.objects.get(id=receiver_id)
        except CustomUser.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        user = request.user
        participants = sorted([user.id, receiver.id])
        conversation, _ = Conversation.objects.get_or_create(
            participant1_id=participants[0],
            participant2_id=participants[1]
        )
        
        msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            message_type='voice',
            file=file,
            file_name=file.name,
            file_size=file.size,
            content=str(duration)  # Store duration in content
        )

        # Send push notification to receiver
        sender_name = f"{user.first_name} {user.last_name}".strip() or user.username
        sender_pic = user.profile_picture.url if user.profile_picture else None
        send_push_notification(
            receiver.id, sender_name, '🎤 Voice message',
            url='/chat/', icon=sender_pic, tag=f'skychat-dm-{user.id}'
        )
        
        return Response({
            'id': msg.id,
            'message_type': 'voice',
            'file_url': msg.file.url,
            'duration': duration,
            'timestamp': msg.timestamp.isoformat()
        })
    
    @action(detail=True, methods=['post'], url_path='read')
    def mark_read(self, request, pk=None):
        """Mark message as read"""
        try:
            msg = Message.objects.get(id=pk)
            if msg.sender != request.user and not msg.is_read:
                msg.is_read = True
                msg.read_at = timezone.now()
                msg.save()
            return Response({
                'is_read': msg.is_read,
                'read_at': msg.read_at.isoformat() if msg.read_at else None
            })
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=True, methods=['post'], url_path='react')
    def react(self, request, pk=None):
        """Add/toggle reaction to message"""
        emoji = request.data.get('emoji')
        if not emoji:
            return Response({'error': 'Emoji required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            msg = Message.objects.get(id=pk)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Toggle reaction
        existing = Reaction.objects.filter(message=msg, user=request.user).first()
        if existing:
            if existing.emoji == emoji:
                existing.delete()
            else:
                existing.emoji = emoji
                existing.save()
        else:
            Reaction.objects.create(message=msg, user=request.user, emoji=emoji)
        
        # Return updated reactions
        reactions = {}
        for r in msg.reactions.all():
            if r.emoji not in reactions:
                reactions[r.emoji] = {'count': 0, 'users': []}
            reactions[r.emoji]['count'] += 1
            reactions[r.emoji]['users'].append(r.user.username)
        
        return Response({'reactions': reactions})
    
    @action(detail=True, methods=['get'], url_path='info')
    def info(self, request, pk=None):
        """Get message info including reactions and read status"""
        try:
            msg = Message.objects.get(id=pk)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)
        
        reactions = {}
        for r in msg.reactions.all():
            if r.emoji not in reactions:
                reactions[r.emoji] = {'count': 0, 'users': []}
            reactions[r.emoji]['count'] += 1
            reactions[r.emoji]['users'].append(r.user.username)
        
        return Response({
            'id': msg.id,
            'content': msg.content,
            'sent_at': msg.timestamp.isoformat(),
            'delivered_at': msg.delivered_at.isoformat() if msg.delivered_at else None,
            'read_at': msg.read_at.isoformat() if msg.read_at else None,
            'is_read': msg.is_read,
            'reactions': reactions
        })

    @action(detail=True, methods=['post'], url_path='edit')
    def edit(self, request, pk=None):
        """Edit a message (only by sender)"""
        try:
            msg = Message.objects.get(id=pk)
            
            # Only sender can edit
            if msg.sender != request.user:
                return Response({'error': 'You can only edit your own messages'}, status=status.HTTP_403_FORBIDDEN)
            
            # Only text messages can be edited
            if msg.message_type != 'text':
                return Response({'error': 'Only text messages can be edited'}, status=status.HTTP_400_BAD_REQUEST)
            
            new_content = request.data.get('message', '').strip()
            if not new_content:
                return Response({'error': 'Message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            
            msg.content = new_content
            msg.save()
            
            return Response({
                'success': True,
                'message_id': pk,
                'content': msg.content
            })
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)