# Chat App - Complete Codebase Documentation

> Auto-generated: April 22, 2026

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Accounts App](#accounts-app)
3. [Chat App](#chat-app)
4. [Calls App](#calls-app)
5. [WebSocket Consumer](#websocket-consumer)
6. [Push Notifications](#push-notifications)
7. [All API Endpoints](#all-api-endpoints)
8. [JavaScript Functions](#javascript-functions)
9. [URL Map](#url-map)

---

## Project Structure

```
chat_app/
├── accounts/          # User auth, profiles, contacts, all main API endpoints
├── chat/              # Models, WebSocket consumer, push notifications, chat UI
├── calls/             # Call & GroupCall models, call history view
├── chat_app/          # Project settings, URLs, ASGI/WSGI, middleware
├── static/js/chat.js  # Frontend logic (single-page app)
├── static/css/        # Stylesheets
├── templates/         # HTML templates
├── media/             # Uploaded files (profile pics, chat files)
├── deploy/            # Deployment configs
├── desktop/           # Electron desktop app wrapper
└── android/           # Android app wrapper
```

---

## Accounts App

### Models (`accounts/models.py`)

#### 1. CustomUser
- **Extends:** `AbstractUser`
- **Extra Fields:**
  - `profile_picture` — ImageField (profile_pics/)
  - `bio` — CharField (max 500)
  - `is_online` — BooleanField (default False)
  - `last_seen` — DateTimeField (nullable)
- **AUTH_USER_MODEL:** `accounts.CustomUser`
- **Used In:** accounts/serializers.py, accounts/views.py, accounts/admin.py, chat/models.py (FK), calls/models.py (FK), chat/consumers.py, chat/fcm.py, chat/push.py

#### 2. PushSubscription
- **Fields:**
  - `user` — FK → CustomUser
  - `subscription_info` — JSONField
  - `created_at` — DateTimeField (auto)
- **Used In:** accounts/views.py (push_subscribe/unsubscribe), chat/push.py (send_web_push)

#### 3. FCMDevice
- **Fields:**
  - `user` — FK → CustomUser
  - `registration_id` — TextField (FCM token)
  - `active` — BooleanField (default True)
  - `created_at` — DateTimeField (auto)
  - `updated_at` — DateTimeField (auto)
- **Used In:** accounts/views.py (fcm_register/unregister), chat/fcm.py (send notifications)

---

### Serializers (`accounts/serializers.py`)

| Serializer | Model | Purpose |
|------------|-------|---------|
| `UserSerializer` | CustomUser | User data serialization |

---

### Views (`accounts/views.py`)

#### UserViewSet (registered at `/api/auth/users/`)

| # | Function | Method | URL Path | Purpose |
|---|----------|--------|----------|---------|
| 1 | `register` | POST | `/api/auth/users/register/` | Create new account (inactive by default) |
| 2 | `login` | POST | `/api/auth/users/login/` | Authenticate, return JWT tokens |
| 3 | `me` | GET | `/api/auth/users/me/` | Get current logged-in user profile |
| 4 | `all_users` | GET | `/api/auth/users/all_users/` | Get all contacts except self |
| 5 | `conversations` | GET | `/api/auth/users/conversations/` | Unified DM + Group conversation list with unread counts |
| 6 | `start_conversation` | POST | `/api/auth/users/start_conversation/` | Create or get existing DM thread |
| 7 | `get_messages` | GET | `/api/auth/users/messages/{user_id}/` | DM message history (paginated) |
| 8 | `groups` | GET | `/api/auth/users/groups/` | List user's groups with unread counts |
| 9 | `create_group` | POST | `/api/auth/users/groups/create/` | Create group + memberships |
| 10 | `add_group_member` | POST | `/api/auth/users/groups/{group_id}/add_member/` | Admin adds member + system message |
| 11 | `leave_group` | POST | `/api/auth/users/groups/{group_id}/leave/` | Member leaves group |
| 12 | `delete_group` | DELETE | `/api/auth/users/groups/{group_id}/delete_group/` | Admin deletes group entirely |
| 13 | `remove_group_member` | POST | `/api/auth/users/groups/{group_id}/remove_member/` | Admin removes a member |
| 14 | `make_group_admin` | POST | `/api/auth/users/groups/{group_id}/make_admin/` | Promote member to admin |
| 15 | `remove_group_admin` | POST | `/api/auth/users/groups/{group_id}/remove_admin/` | Demote admin to member |
| 16 | `group_active_call` | GET | `/api/auth/users/groups/{group_id}/active_call/` | Check if group has active call + stale cleanup |
| 17 | `group_info` | GET | `/api/auth/users/groups/{group_id}/info/` | Group detail with member metadata |
| 18 | `mark_group_read` | POST | `/api/auth/users/groups/{group_id}/mark_read/` | Create read receipts for group messages |
| 19 | `group_message_info` | GET | `/api/auth/users/groups/messages/{message_id}/info/` | Per-user delivered/read info for group msg |
| 20 | `group_messages` | GET | `/api/auth/users/groups/{group_id}/messages/` | Group message history with reactions/replies |
| 21 | `upload_file` | POST | `/api/auth/users/messages/upload/` | File upload for DM/Group + WS broadcast |
| 22 | `upload_voice` | POST | `/api/auth/users/messages/voice/` | Voice message upload + WS broadcast |
| 23 | `react_to_message` | POST | `/api/auth/users/messages/{message_id}/react/` | Add/update emoji reaction |
| 24 | `remove_reaction` | DELETE | `/api/auth/users/messages/{message_id}/unreact/` | Remove own reaction |
| 25 | `mark_message_read` | POST | `/api/auth/users/messages/{message_id}/read/` | Mark single message as read |
| 26 | `edit_message` | PUT | `/api/auth/users/messages/{message_id}/edit/` | Edit own text message (time-limited) |
| 27 | `mark_conversation_read` | POST | `/api/auth/users/messages/mark_read/` | Bulk mark DM conversation as read |
| 28 | `message_info` | GET | `/api/auth/users/messages/{message_id}/info/` | Message metadata + reactions |
| 29 | `call_history` | GET | `/api/auth/users/call_history/` | Merged DM + group call log |
| 30 | `profile` | GET/PUT | `/api/auth/users/profile/` | Get or update user profile |
| 31 | `update_profile_picture` | POST | `/api/auth/users/profile_picture/` | Upload profile picture |
| 32 | `remove_profile_picture` | DELETE | `/api/auth/users/remove_picture/` | Remove profile picture |
| 33 | `delete_conversation` | POST | `/api/auth/users/delete_conversation/{user_id}/` | Per-user DM clear (ConversationClear) |
| 34 | `clear_group_chat` | POST | `/api/auth/users/clear_group/{group_id}/` | Per-user group timeline clear |
| 35 | `contact_media` | GET | `/api/auth/users/contact_media/{user_id}/` | List DM media files |
| 36 | `group_media` | GET | `/api/auth/users/group_media/{group_id}/` | List group media files |
| 37 | `vapid_public_key` | GET | `/api/auth/users/vapid_public_key/` | VAPID public key for web push |
| 38 | `push_subscribe` | POST | `/api/auth/users/push_subscribe/` | Save browser push subscription |
| 39 | `push_unsubscribe` | POST | `/api/auth/users/push_unsubscribe/` | Remove browser push subscription |
| 40 | `fcm_register` | POST | `/api/auth/users/fcm_register/` | Register FCM device token |
| 41 | `fcm_unregister` | POST | `/api/auth/users/fcm_unregister/` | Unregister FCM device token |

#### MessageViewSet (registered at `/api/auth/messages/`)

| # | Function | Method | URL Path | Purpose |
|---|----------|--------|----------|---------|
| 1 | `upload_file` | POST | `/api/auth/messages/upload/` | File upload (duplicate endpoint) |
| 2 | `upload_voice` | POST | `/api/auth/messages/voice/` | Voice upload (duplicate endpoint) |
| 3 | `mark_read` | POST | `/api/auth/messages/{id}/read/` | Mark message read |
| 4 | `react` | POST | `/api/auth/messages/{id}/react/` | Add reaction |
| 5 | `info` | GET | `/api/auth/messages/{id}/info/` | Message info |
| 6 | `edit` | PUT | `/api/auth/messages/{id}/edit/` | Edit message |

#### Standalone View

| Function | URL | Purpose |
|----------|-----|---------|
| `index` | `/` and `/login/` | Landing page / login page render |

---

## Chat App

### Models (`chat/models.py`)

#### 1. Conversation
- **Fields:**
  - `participant1` — FK → CustomUser
  - `participant2` — FK → CustomUser
  - `created_at` — DateTimeField (auto)
  - `updated_at` — DateTimeField (auto)
- **Used In:** accounts/views.py, chat/consumers.py, chat/admin.py

#### 2. Message
- **Fields:**
  - `conversation` — FK → Conversation (nullable)
  - `group` — FK → Group (nullable)
  - `sender` — FK → CustomUser
  - `content` — TextField (blank allowed)
  - `timestamp` — DateTimeField (auto)
  - `is_read` — BooleanField
  - `delivered_at` — DateTimeField (nullable)
  - `read_at` — DateTimeField (nullable)
  - `is_system_message` — BooleanField
  - `reply_to` — FK → self (nullable)
  - `file` — FileField (nullable)
  - `file_name` — CharField (nullable)
  - `file_size` — IntegerField (nullable)
  - `file_type` — CharField (nullable)
  - `is_voice` — BooleanField
  - `voice_duration` — FloatField (nullable)
  - `is_edited` — BooleanField
  - `group_picture` — ImageField (nullable)
- **Used In:** accounts/views.py, chat/consumers.py, chat/admin.py

#### 3. Reaction
- **Fields:**
  - `message` — FK → Message
  - `user` — FK → CustomUser
  - `emoji` — CharField (max 10)
  - `created_at` — DateTimeField (auto)
- **Unique Together:** (message, user)
- **Used In:** accounts/views.py

#### 4. Group
- **Fields:**
  - `name` — CharField (max 100)
  - `description` — TextField (blank)
  - `admin` — FK → CustomUser (creator)
  - `members` — ManyToMany → CustomUser
  - `created_at` — DateTimeField (auto)
  - `updated_at` — DateTimeField (auto)
  - `group_picture` — ImageField (nullable)
- **Used In:** accounts/views.py, chat/consumers.py, chat/admin.py, calls/models.py (FK from GroupCall)

#### 5. GroupMembership
- **Fields:**
  - `group` — FK → Group
  - `user` — FK → CustomUser
  - `is_admin` — BooleanField (default False)
  - `joined_at` — DateTimeField (auto)
  - `cleared_at` — DateTimeField (nullable)
- **Unique Together:** (group, user)
- **Used In:** accounts/views.py, chat/admin.py

#### 6. ConversationClear
- **Fields:**
  - `conversation` — FK → Conversation
  - `user` — FK → CustomUser
  - `cleared_at` — DateTimeField (auto)
- **Unique Together:** (conversation, user)
- **Used In:** accounts/views.py

#### 7. MessageReadReceipt
- **Fields:**
  - `message` — FK → Message
  - `user` — FK → CustomUser
  - `read_at` — DateTimeField (auto)
- **Unique Together:** (message, user)
- **Used In:** accounts/views.py, chat/consumers.py, chat/admin.py

---

### Views (`chat/views.py`)

| # | Function | Method | URL Path | Purpose |
|---|----------|--------|----------|---------|
| 1 | `chat` | GET | `/chat/` | Render main chat UI page |
| 2 | `get_turn_credentials` | GET | `/chat/api/turn-credentials/` | Return TURN server credentials for WebRTC |
| 3 | `active_group_calls` | GET | `/api/active-group-calls/` | List active group calls + stale cleanup |

---

## Calls App

### Models (`calls/models.py`)

#### 1. Call (1:1 Calls)
- **Fields:**
  - `caller` — FK → CustomUser
  - `receiver` — FK → CustomUser
  - `call_type` — CharField (audio/video)
  - `status` — CharField (initiated/ringing/answered/ended/missed/rejected/cancelled)
  - `started_at` — DateTimeField (auto)
  - `ended_at` — DateTimeField (nullable)
  - `duration` — IntegerField (default 0)
- **Used In:** calls/views.py, accounts/views.py, chat/consumers.py, calls/admin.py

#### 2. GroupCall
- **Fields:**
  - `group` — FK → Group (nullable)
  - `group_name` — CharField (nullable, for ad-hoc calls)
  - `initiator` — FK → CustomUser
  - `call_type` — CharField (audio/video)
  - `status` — CharField (active/ended)
  - `started_at` — DateTimeField (auto)
  - `ended_at` — DateTimeField (nullable)
- **Used In:** calls/views.py, accounts/views.py, chat/views.py, chat/consumers.py

#### 3. GroupCallParticipant
- **Fields:**
  - `group_call` — FK → GroupCall
  - `user` — FK → CustomUser
  - `joined_at` — DateTimeField (auto)
  - `left_at` — DateTimeField (nullable)
- **Used In:** calls/views.py, accounts/views.py, chat/views.py, chat/consumers.py

---

### Views (`calls/views.py`)

| # | Function | Method | URL Path | Purpose |
|---|----------|--------|----------|---------|
| 1 | `call_history` | GET | `/api/call_history/` | Combined DM + group call history |

---

## WebSocket Consumer

### File: `chat/consumers.py`
### Route: `ws/chat/{room_name}/` (defined in `chat/routing.py`)

### Connection Lifecycle

| Method | Purpose |
|--------|---------|
| `connect` | Authenticate via JWT, join user channel, set online, notify contacts |
| `disconnect` | Set offline, leave groups, cleanup group calls, notify contacts |
| `receive` | Route incoming JSON to appropriate handler by `type` field |

### Message Handlers (incoming from client)

| Handler | WS Type | Purpose |
|---------|---------|---------|
| `handle_chat_message` | `chat_message` | Send DM message, save to DB, push notification |
| `handle_group_read` | `group_read` | Mark group messages as read, send receipts |
| `handle_group_system` | `group_system` | Send system message to group |
| `handle_message_edit` | `message_edit` | Edit message content via WS |
| `handle_typing` | `typing` | Send typing indicator to other user/group |
| `handle_reaction` | `reaction` | Add/remove reaction via WS |

### 1:1 Call Signaling Handlers

| Handler | WS Type | Purpose |
|---------|---------|---------|
| `handle_call_initiate` | `call_initiate` | Start a call, create Call record, notify receiver |
| `handle_call_accept` | `call_accept` | Accept incoming call, update status |
| `handle_call_reject` | `call_reject` | Reject incoming call |
| `handle_call_end` | `call_end` | End active call, calculate duration |
| `handle_call_cancel` | `call_cancel` | Cancel outgoing call before answer |
| `handle_call_ice` | `call_ice` | Relay ICE candidates |

### Screen Share Signaling

| Handler | WS Type | Purpose |
|---------|---------|---------|
| `handle_screen_offer` | `screen_offer` | Send screen share SDP offer |
| `handle_screen_answer` | `screen_answer` | Send screen share SDP answer |
| `handle_screen_toggle` | `screen_toggle` | Toggle screen sharing state |

### Group Call Signaling

| Handler | WS Type | Purpose |
|---------|---------|---------|
| `handle_group_call_start` | `group_call_start` | Start group call, create GroupCall record |
| `handle_group_call_join` | `group_call_join` | Join existing group call |
| `handle_group_call_offer` | `group_call_offer` | Relay SDP offer to specific peer |
| `handle_group_call_answer` | `group_call_answer` | Relay SDP answer to specific peer |
| `handle_group_call_ice` | `group_call_ice` | Relay ICE candidates to specific peer |
| `handle_group_call_leave` | `group_call_leave` | Leave group call, notify peers |
| `handle_gc_screen_toggle` | `gc_screen_toggle` | Toggle screen share in group call |

### Call Upgrade/Invite

| Handler | WS Type | Purpose |
|---------|---------|---------|
| `handle_call_upgrade` | `call_upgrade` | Upgrade audio call to video |
| `handle_group_call_invite` | `group_call_invite` | Invite more users to group call |

### Outbound Events (sent to client)

| Event | Purpose |
|-------|---------|
| `chat_message` | New DM message received |
| `voice_message` | New voice message received |
| `file_message` | New file message received |
| `group_read_receipt` | Group read receipt update |
| `system_message` | Group system message (member added/left etc) |
| `call_incoming` | Incoming call notification |
| `call_accepted` | Call was accepted |
| `call_rejected` | Call was rejected |
| `call_ended` | Call ended |
| `call_cancelled` | Call was cancelled |
| `call_ice` | ICE candidate received |
| `screen_offer` / `screen_answer` / `screen_toggle` | Screen share signaling |
| `call_upgrade_notify` | Call upgrade request |
| `group_call_invite_notify` | Group call invitation |
| `group_call_notify` | Group call started notification |
| `group_call_ended_notify` | Group call ended notification |
| `group_call_user_joined` | User joined group call |
| `group_call_offer_relay` / `answer_relay` / `ice_relay` | WebRTC relay for group calls |
| `gc_screen_toggle_relay` | Group call screen share toggle |
| `group_call_user_left` | User left group call |
| `message_edited` | Message was edited |
| `typing_indicator` | User is typing |
| `reaction_update` | Reaction added/removed |
| `online_status` | User online/offline status |
| `new_message_notify` | New message push (for global WS) |
| `user_join` / `user_leave` | User join/leave channel group |

### Database Helper Methods (in consumer)

| Method | Purpose |
|--------|---------|
| `save_message` | Save DM message to DB |
| `save_group_message` | Save group message to DB |
| `create_call` | Create Call record |
| `update_call_status` | Update call status |
| `end_call` | End call + calculate duration |
| `create_group_call` | Create GroupCall record |
| `create_adhoc_group_call` | Create ad-hoc GroupCall (no group) |
| `add_group_call_participant` | Add participant to GroupCall |
| `mark_group_call_left` | Mark participant as left |
| `end_group_call` | End group call |
| `get_active_participant_count` | Count active participants |
| `get_group_call_participant_ids` | Get participant user IDs |
| `get_group_call_participants_info` | Get participant details |
| `get_group_member_ids` | Get all group member IDs |
| `get_group_name` | Get group name by ID |
| `get_group_id_from_call` | Get group ID from GroupCall |
| `get_group_call_name` | Get display name for group call |
| `get_user_active_group_calls` | Get user's active group calls |
| `cleanup_user_group_calls` | Clean up stale group calls on disconnect |
| `update_last_seen` | Update user's last_seen timestamp |
| `set_user_online` | Set user online/offline |
| `get_contact_ids` | Get all user IDs who have conversations with user |
| `get_user_id_by_username` | Lookup user ID by username |
| `get_user_by_id` | Get user details by ID |
| `get_reply_data` | Get reply-to message data |
| `save_group_read_receipts` | Bulk create read receipts |
| `send_dm_push` | Send push for DM message |
| `send_group_push` | Send push for group message |
| `send_group_call_push` | Send push for group call |

---

## Push Notifications

### FCM (`chat/fcm.py`)

| Function | Purpose |
|----------|---------|
| `send_fcm_notification(sender, receiver_id, message, msg_type)` | Send FCM for new message (DM/group) |
| `send_fcm_call_notification(caller, receiver_id, call_type, call_id)` | Send FCM for incoming call |
| `send_fcm_call_cancel(caller, receiver_id, call_id)` | Send FCM to cancel call notification |

### Web Push (`chat/push.py`)

| Function | Purpose |
|----------|---------|
| `send_web_push(user, title, body, data)` | Send web push via VAPID to browser |

---

## All API Endpoints (Complete URL Map)

### Project URLs (`chat_app/urls.py`)

```
/                                    → accounts index (login page)
/login/                              → accounts index (login page)
/chat/                               → chat page
/chat/api/turn-credentials/          → TURN credentials
/api/active-group-calls/             → active group calls
/offline/                            → offline template
/sw.js                               → service worker
/manifest.json                       → PWA manifest
/admin/                              → Django admin
/api/auth/                           → accounts router (users + messages)
/api/auth/token/refresh/             → JWT token refresh
/api/call_history/                   → call history
/media/<path>                        → media files
```

### Accounts Router (`/api/auth/`)

```
/api/auth/users/register/                              POST    → Register
/api/auth/users/login/                                 POST    → Login
/api/auth/users/me/                                    GET     → Current user
/api/auth/users/all_users/                             GET     → All contacts
/api/auth/users/conversations/                         GET     → Conversations list
/api/auth/users/start_conversation/                    POST    → Start DM
/api/auth/users/messages/<user_id>/                    GET     → DM messages
/api/auth/users/messages/upload/                       POST    → Upload file
/api/auth/users/messages/voice/                        POST    → Upload voice
/api/auth/users/messages/mark_read/                    POST    → Mark conversation read
/api/auth/users/messages/<msg_id>/react/               POST    → React
/api/auth/users/messages/<msg_id>/unreact/             DELETE  → Remove reaction
/api/auth/users/messages/<msg_id>/read/                POST    → Mark message read
/api/auth/users/messages/<msg_id>/edit/                PUT     → Edit message
/api/auth/users/messages/<msg_id>/info/                GET     → Message info
/api/auth/users/groups/                                GET     → My groups
/api/auth/users/groups/create/                         POST    → Create group
/api/auth/users/groups/<gid>/add_member/               POST    → Add member
/api/auth/users/groups/<gid>/leave/                    POST    → Leave group
/api/auth/users/groups/<gid>/delete_group/             DELETE  → Delete group
/api/auth/users/groups/<gid>/remove_member/            POST    → Remove member
/api/auth/users/groups/<gid>/make_admin/               POST    → Make admin
/api/auth/users/groups/<gid>/remove_admin/             POST    → Remove admin
/api/auth/users/groups/<gid>/active_call/              GET     → Active call
/api/auth/users/groups/<gid>/info/                     GET     → Group info
/api/auth/users/groups/<gid>/mark_read/                POST    → Mark group read
/api/auth/users/groups/<gid>/messages/                 GET     → Group messages
/api/auth/users/groups/messages/<msg_id>/info/         GET     → Group message info
/api/auth/users/call_history/                          GET     → Call history
/api/auth/users/profile/                               GET/PUT → Profile
/api/auth/users/profile_picture/                       POST    → Upload picture
/api/auth/users/remove_picture/                        DELETE  → Remove picture
/api/auth/users/delete_conversation/<uid>/             POST    → Clear DM
/api/auth/users/clear_group/<gid>/                     POST    → Clear group
/api/auth/users/contact_media/<uid>/                   GET     → DM media
/api/auth/users/group_media/<gid>/                     GET     → Group media
/api/auth/users/vapid_public_key/                      GET     → VAPID key
/api/auth/users/push_subscribe/                        POST    → Web push subscribe
/api/auth/users/push_unsubscribe/                      POST    → Web push unsubscribe
/api/auth/users/fcm_register/                          POST    → FCM register
/api/auth/users/fcm_unregister/                        POST    → FCM unregister
```

### WebSocket Route

```
ws/chat/<room_name>/    → ChatConsumer (chat/routing.py)
```

---

## JavaScript Functions (`static/js/chat.js`)

### Core / Bootstrap

| Function | Purpose |
|----------|---------|
| `init()` | App initialization on page load |
| `api(path, opts)` | API helper with auto-token refresh |
| `refreshAccessToken()` | Refresh JWT access token |
| `connectWS()` | Connect DM WebSocket |
| `connectGlobalWS()` | Connect global notification WebSocket |
| `connectGroupWS()` | Connect group WebSocket |
| `handleWS()` | Route incoming WS messages to handlers |

### Conversation / Group UI

| Function | Purpose |
|----------|---------|
| `loadConvs()` | Load conversation list |
| `loadGroups()` | Load group list |
| `renderConvList()` | Render conversation sidebar |
| `renderGroupList()` | Render group sidebar |
| `openChat(userId)` | Open DM chat |
| `openGroup(groupId)` | Open group chat |
| `showChatView()` | Show chat panel |
| `showGroupView()` | Show group panel |
| `hlActive()` | Highlight active conversation |
| `handleSearch()` | Search conversations/contacts |

### Messaging

| Function | Purpose |
|----------|---------|
| `sendText()` | Send text message |
| `appendMsg(msg)` | Append message to chat UI |
| `loadMessages()` | Load DM message history |
| `loadGroupMessages()` | Load group message history |
| `markMessageRead()` | Mark message as read |
| `notifyMessageRead()` | Send read notification |
| `updateMessageTick()` | Update read/delivered tick marks |

### Message Actions

| Function | Purpose |
|----------|---------|
| `msgDropdownHTML()` | Generate message action dropdown HTML |
| `toggleMsgDropdown()` | Toggle action dropdown |
| `reactToMsg(msgId, emoji)` | Add reaction to message |
| `updateMessageReactions()` | Update reaction display |
| `replyToMsg(msgId)` | Set reply target |
| `cancelReply()` | Cancel reply mode |
| `forwardMsg(msgId)` | Forward message |
| `sendForwardedMsg()` | Execute forward |
| `copyMsg(msgId)` | Copy message text |
| `showMsgInfo(msgId)` | Show message info panel |
| `editMsg(msgId)` | Start editing message |
| `saveEditedMsg()` | Save edited message |

### Files / Media

| Function | Purpose |
|----------|---------|
| `handleFileSelect()` | Handle file selection from input |
| `showFilePreview()` | Preview file before sending |
| `uploadFile()` | Upload file to server |
| `openMedia()` | Open media in viewer |
| `closeMediaPreview()` | Close media viewer |
| `downloadFile()` | Download file |
| `openFilePreview()` | Open file preview |
| `canPreviewFile()` | Check if file is previewable |
| `formatFileSize()` | Format bytes to human-readable |

### Voice Notes

| Function | Purpose |
|----------|---------|
| `startVoiceRecord()` | Start recording voice |
| `stopVoiceRecord()` | Stop recording |
| `cancelVoice()` | Cancel recording |
| `sendVoice()` | Send voice message |
| `doSendVoice()` | Execute voice upload |
| `playVoice()` | Play voice message |

### Typing / Online / Notifications

| Function | Purpose |
|----------|---------|
| `sendTyping()` | Send typing indicator |
| `onInputTyping()` | Handle input typing event |
| `handleTypingIndicator()` | Display typing indicator |
| `handleOnlineStatus()` | Update user online status |
| `handleNewMessageNotify()` | Handle new message notification |
| `showNotification()` | Show browser notification |
| `showPopupNotification()` | Show in-app popup notification |
| `requestNotificationPermission()` | Request browser notification permission |

### Group Management

| Function | Purpose |
|----------|---------|
| `openNewGroup()` | Open new group creation UI |
| `createGroup()` | Create new group |
| `openContactInfo()` | Open contact info panel |
| `openGroupInfo()` | Open group info panel |
| `addGroupMember()` | Add member to group |
| `removeGroupMember()` | Remove member from group |
| `makeGroupAdmin()` | Promote to admin |
| `removeGroupAdmin()` | Demote from admin |
| `leaveGroup()` | Leave group |
| `deleteGroup()` | Delete group |

### Call History / Profile

| Function | Purpose |
|----------|---------|
| `loadCallHistory()` | Load call history |
| `renderCallHistory()` | Render call history UI |
| `callUser()` | Initiate call to user |
| `openProfile()` | Open profile panel |
| `saveProfile()` | Save profile changes |
| `uploadProfilePicture()` | Upload profile picture |
| `removeProfilePicture()` | Remove profile picture |

### 1:1 WebRTC Calls

| Function | Purpose |
|----------|---------|
| `startCall(type)` | Initiate audio/video call |
| `initWebRTC()` | Initialize WebRTC peer connection |
| `doInitWebRTC()` | Create RTCPeerConnection |
| `handleIncomingCall()` | Handle incoming call notification |
| `acceptCall()` | Accept incoming call |
| `rejectCall()` | Reject incoming call |
| `cancelCall()` | Cancel outgoing call |
| `endCall()` | End active call |
| `handleCallAccepted()` | Handle call accepted event |
| `handleCallRejected()` | Handle call rejected event |
| `handleCallEnded()` | Handle call ended event |
| `handleIceCandidate()` | Handle ICE candidate |
| `toggleMic()` | Toggle microphone |
| `toggleCam()` | Toggle camera |
| `toggleSpeaker()` | Toggle speaker |
| `toggleScreenShare()` | Toggle screen sharing |

### Call UI / PIP

| Function | Purpose |
|----------|---------|
| `showOngoingCall()` | Show full call screen |
| `minimizeCall()` | Minimize to PIP |
| `minimizeGroupCall()` | Minimize group call to PIP |
| `expandCall()` | Expand from PIP |
| `pipEndCall()` | End call from PIP |
| `makePipDraggable()` | Make PIP window draggable |

### Group Call System

| Function | Purpose |
|----------|---------|
| `startGroupCall()` | Start group call |
| `handleGroupCallStarted()` | Handle group call started event |
| `handleGroupCallNotify()` | Handle group call notification |
| `joinGroupCallFromBanner()` | Join call from banner UI |
| `handleGroupCallJoined()` | Handle joined event |
| `handleGroupCallOffer()` | Handle SDP offer from peer |
| `handleGroupCallAnswer()` | Handle SDP answer from peer |
| `handleGroupCallIce()` | Handle ICE candidate from peer |
| `handleGroupCallUserLeft()` | Handle peer leaving |
| `leaveGroupCall()` | Leave group call |
| `cleanupGroupCall()` | Cleanup group call resources |
| `gcToggleMic()` | Toggle mic in group call |
| `gcToggleCam()` | Toggle camera in group call |

### Group Call Screen Share / Detection

| Function | Purpose |
|----------|---------|
| `gcToggleScreenShare()` | Toggle screen share in group call |
| `gcStartScreenShare()` | Start screen share |
| `gcStopScreenShare()` | Stop screen share |
| `handleGcScreenToggle()` | Handle remote screen toggle |
| `gcOpenScreenZoom()` | Zoom in on shared screen |
| `gcCloseScreenZoom()` | Close screen zoom |
| `gcStartTalkingDetection()` | Start audio level detection |
| `gcCheckTalkingLevels()` | Check who's talking |
| `updateGroupCallParticipantCount()` | Update participant count UI |

### Push Subscription

| Function | Purpose |
|----------|---------|
| `subscribePush()` | Subscribe to browser push notifications |
| `sendSubToServer()` | Send subscription to server |
| `urlBase64ToUint8Array()` | Convert VAPID key format |

### Utility Functions

| Function | Purpose |
|----------|---------|
| `$()` | `document.getElementById()` shortcut |
| `esc()` | HTML escape function |
| `seed()` | Generate SVG avatar from text |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Django + Django REST Framework |
| WebSocket | Django Channels (ASGI) |
| Auth | JWT (SimpleJWT) |
| Database | SQLite (dev) |
| Real-time | WebSocket + Channel Layers |
| WebRTC | Peer-to-peer (1:1) + Mesh (group calls) |
| Push | Web Push (VAPID) + Firebase Cloud Messaging |
| Frontend | Vanilla JS (single-page app) |
| Desktop | Electron |
| Android | WebView wrapper |

---

*End of Documentation*
