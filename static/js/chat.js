/* SkyChat - Main Chat JavaScript */

// Tick SVG generator - WhatsApp style
function tickSVG(status) {
  if (status === 'read') {
    return `<span class="msg-ticks read">
      <i class="fa-solid fa-check"></i><i class="fa-solid fa-check"></i>
    </span>`;
  } else if (status === 'delivered') {
    return `<span class="msg-ticks">
      <i class="fa-solid fa-check"></i><i class="fa-solid fa-check"></i>
    </span>`;
  } else {
    return `<span class="msg-ticks">
      <i class="fa-solid fa-check"></i>
    </span>`;
  }
}

// Notification popup
function showNotifPopup(msg) {
  const stack = document.getElementById('notif-stack');
  const av = msg.profile_picture || seed(msg.username || 'user');
  const name = msg.username || 'Someone';
  const body = msg.message || '';
  const el = document.createElement('div');
  el.className = 'notif-popup';
  el.innerHTML = `<img class="notif-av" src="${esc(av)}">
    <div class="notif-body">
      <div class="notif-name">${esc(name)}</div>
      <div class="notif-msg">${esc(body)}</div>
    </div>`;
  el.onclick = function () { el.remove(); };
  stack.appendChild(el);
  setTimeout(function () {
    el.classList.add('hiding');
    setTimeout(function () { el.remove(); }, 350);
  }, 5000);
}

// Configuration
const API_URL = '/api/auth/users';
const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/chat/';

// State
const S = {
  user: null,
  token: localStorage.getItem('access_token'),
  convs: [],
  groups: [],
  allUsers: [],
  activeUser: null,
  activeGroup: null,
  isGroup: false,
  ws: null,
  wsRoom: null,
  globalWs: null,  // Global WebSocket for calls
  emojiOpen: false,
  selectedGroupUsers: [],
  currentTab: 'chats',
  replyTo: null
};

// Emoji Categories
const ECATS = [
  { i: '😀', e: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧'] },
  { i: '👋', e: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '🤝', '💪'] },
  { i: '❤️', e: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💯', '✅', '❎'] }
];

// Quick reaction emojis
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Build emoji picker
function buildEmoji() {
  const cats = document.getElementById('ep-cats');
  ECATS.forEach(function (cat, i) {
    const b = document.createElement('button');
    b.className = 'ep-cat' + (i === 0 ? ' on' : '');
    b.textContent = cat.i;
    b.onclick = function () {
      document.querySelectorAll('.ep-cat').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      renderEG(cat.e);
    };
    cats.appendChild(b);
  });
  renderEG(ECATS[0].e);
}

function renderEG(emojis) {
  var g = document.getElementById('ep-grid');
  g.innerHTML = '';
  emojis.forEach(function (e) {
    var b = document.createElement('button');
    b.className = 'ep-emoji';
    b.textContent = e;
    b.onclick = function () { insertEmoji(e); };
    g.appendChild(b);
  });
}

function insertEmoji(e) {
  var ta = document.getElementById('msg-ta');
  var s = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + e + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = s + e.length;
  ta.focus();
  updateSendBtn();
}

function toggleEmoji() {
  S.emojiOpen = !S.emojiOpen;
  document.getElementById('emoji-picker').classList.toggle('open', S.emojiOpen);
}

// Close emoji picker and dropdowns when clicking outside
document.addEventListener('click', function (e) {
  if (!e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn')) {
    document.getElementById('emoji-picker').classList.remove('open');
    S.emojiOpen = false;
  }
  // Close message dropdowns
  if (!e.target.closest('.msg-dropdown') && !e.target.closest('.msg-dropdown-btn')) {
    document.querySelectorAll('.msg-dropdown.show').forEach(function (d) {
      d.classList.remove('show');
    });
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
  // ESC to close media preview
  if (e.key === 'Escape') {
    var mediaPreview = document.getElementById('media-preview');
    if (mediaPreview && mediaPreview.classList.contains('active')) {
      closeMediaPreview();
      e.preventDefault();
    }
  }
});

// Utility functions
var $ = function (id) { return document.getElementById(id); };
var go = function (p) { window.location.href = p; };
var doLogout = function () {
  localStorage.clear();
  sessionStorage.clear();
  // Clear service worker cache
  if ('caches' in window) {
    caches.keys().then(function (names) {
      names.forEach(function (name) { caches.delete(name); });
    });
  }
  go('/login/');
};

// Test media permissions - helps users grant camera/mic access
function testMediaPermissions() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Your browser does not support camera/microphone access', 'e');
    return;
  }

  toast('Requesting camera and microphone access...', 'i');

  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(function (stream) {
      // Success! Stop tracks immediately
      stream.getTracks().forEach(function (track) { track.stop(); });
      toast('Camera and microphone access granted!', 's');
    })
    .catch(function (err) {
      console.error('Permission test error:', err);
      var msg = '';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Permission denied. Click the camera icon in browser address bar to allow access.';
      } else if (err.name === 'NotFoundError') {
        msg = 'No camera or microphone found. Please connect a device.';
      } else if (err.name === 'NotReadableError') {
        msg = 'Camera/microphone in use by another app. Close it and try again.';
      } else {
        msg = 'Could not access camera/microphone: ' + (err.message || err.name);
      }
      toast(msg, 'e');
    });
}

function dname(u) {
  if (!u) return 'Unknown';
  return u.first_name ? (u.first_name + (u.last_name ? ' ' + u.last_name : '')) : (u.username || 'Unknown');
}

function seed(n) {
  return 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(n || 'user');
}

// Get avatar URL - use profile_picture if available, otherwise seed
function getAvatar(user) {
  if (!user) return seed('user');
  if (user.profile_picture) return user.profile_picture;
  return seed(user.username || user.first_name || 'user');
}

function esc(s) {
  return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pakistan timezone
const PKT = 'Asia/Karachi';

function fmtTime(iso) {
  if (!iso) return '';
  var d = new Date(iso), now = new Date();
  var opts = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: PKT };
  return d.toDateString() === now.toDateString() ?
    d.toLocaleTimeString('en-PK', opts) :
    d.toLocaleDateString('en-PK', { month: 'short', day: 'numeric', timeZone: PKT });
}

function fmtFullTime(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: PKT }) + ' at ' +
    d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: PKT });
}

function toast(msg, type) {
  var icons = {
    s: '<i class="fa-solid fa-circle-check" style="color:#34c759"></i>',
    e: '<i class="fa-solid fa-circle-xmark" style="color:var(--red)"></i>',
    i: '<i class="fa-solid fa-circle-info" style="color:var(--blue)"></i>'
  };
  var t = document.createElement('div');
  t.className = 'toast ' + (type === 's' ? 'success' : type === 'e' ? 'error' : '');
  t.innerHTML = (icons[type] || icons.i) + ' ' + esc(msg);
  $('toasts').appendChild(t);
  setTimeout(function () { t.remove(); }, 3500);
}

function lastSeenStr(iso) {
  if (!iso) return 'Last seen: a while ago';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return 'Last seen: a while ago';
  var now = new Date(), diff = Math.floor((now - d) / 1000);
  var hm = d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: PKT });
  if (diff < 60) return 'Last seen just now';
  if (diff < 3600) return 'Last seen ' + Math.floor(diff / 60) + ' min ago';
  var yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Last seen today at ' + hm;
  if (d.toDateString() === yesterday.toDateString()) return 'Last seen yesterday at ' + hm;
  return 'Last seen ' + d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: PKT }) + ' at ' + hm;
}

// API function
function api(path, opts) {
  opts = opts || {};
  var headers = {
    'Authorization': 'Bearer ' + S.token,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache'
  };
  if (opts.body && typeof opts.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(API_URL + path, Object.assign({ headers: headers }, opts))
    .then(function (r) {
      if (r.status === 401) { go('/login/'); return null; }
      if (!r.ok) throw new Error('API error');
      return r.json();
    });
}

// Pasted image state
var PasteState = {
  file: null,
  blob: null
};

// Initialize app
function init() {
  if (!S.token) return go('/login/');
  // Force fresh - no cache
  fetch(API_URL + '/me/', {
    headers: {
      'Authorization': 'Bearer ' + S.token,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  })
    .then(function (r) {
      if (r.status === 401) { go('/login/'); return null; }
      return r.json();
    })
    .then(function (user) {
      if (!user) return;
      S.user = user;

      // Header mein user ka naam
      var fullName = ((S.user.first_name || '') + ' ' + (S.user.last_name || '')).trim() || S.user.username;
      $('sb-username').textContent = fullName;

      // Avatar ya initial letter
      // Avatar ya initial letter
      var initial = (S.user.first_name || S.user.username || 'U')[0].toUpperCase();
      var myAv = $('my-av');
      var myAvInit = $('my-av-init');

      if (S.user.profile_picture) {
        // Picture hai - show karo
        myAv.src = S.user.profile_picture + '?t=' + Date.now();
        myAv.style.cssText = 'display:block;width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.4);';
        myAvInit.style.display = 'none';

        // Agar image load fail ho to letter show karo
        myAv.onerror = function () {
          myAv.style.display = 'none';
          myAvInit.textContent = initial;
          myAvInit.style.display = 'flex';
        };
      } else {
        // No picture - letter show karo
        myAv.style.display = 'none';
        myAvInit.textContent = initial;
        myAvInit.style.display = 'flex';
      }

      buildEmoji();
      loadConvs();
      loadGroups();
      connectGlobalWS();
      loadTURNServers(); 
      initPasteHandler();
    }).catch(function () { go('/login/'); });
}

// Initialize paste handler for images
function initPasteHandler() {
  document.addEventListener('paste', function (e) {
    // Skip if no chat is open
    if (!S.activeUser && !S.activeGroup) return;

    // Skip if user is typing in search or profile inputs
    var activeEl = document.activeElement;
    var tagName = activeEl.tagName.toLowerCase();
    var inputId = activeEl.id || '';

    // Allow paste in message input, caption input, or when focused on body/chat area
    var isMessageInput = inputId === 'msg-ta' || inputId === 'paste-caption';
    var isSearchInput = inputId.indexOf('srch') !== -1 || inputId.indexOf('search') !== -1;
    var isProfileInput = inputId.indexOf('pf-') !== -1;
    var isOtherTextInput = (tagName === 'input' || tagName === 'textarea') && !isMessageInput;

    // If focused on a non-message input, don't intercept paste
    if (isSearchInput || isProfileInput || (isOtherTextInput && !isMessageInput)) {
      return;
    }

    var items = e.clipboardData && e.clipboardData.items;
    if (!items) {
      // Try reading from clipboard API for screenshots
      if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(function (clipboardItems) {
          for (var item of clipboardItems) {
            for (var type of item.types) {
              if (type.startsWith('image/')) {
                item.getType(type).then(function (blob) {
                  if (blob) {
                    showPastePreview(blob);
                  }
                });
                return;
              }
            }
          }
        }).catch(function (err) {
          console.log('Clipboard read error:', err);
        });
      }
      return;
    }

    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (blob) {
          showPastePreview(blob);
        }
        break;
      }
    }
  });
}

// Show paste preview modal
function showPastePreview(blob) {
  if (!S.activeUser && !S.activeGroup) {
    toast('Select a conversation first', 'e');
    return;
  }

  PasteState.blob = blob;
  PasteState.file = new File([blob], 'pasted_image_' + Date.now() + '.png', { type: blob.type });

  var reader = new FileReader();
  reader.onload = function (e) {
    $('paste-preview').src = e.target.result;
    $('paste-caption').value = '';
    openM('paste-modal');
    setTimeout(function () { $('paste-caption').focus(); }, 100);
  };
  reader.readAsDataURL(blob);
}

// Close paste preview
function closePastePreview() {
  PasteState.file = null;
  PasteState.blob = null;
  $('paste-preview').src = '';
  closeM('paste-modal');
}

// Send pasted image
function sendPastedImage() {
  if (!PasteState.file) {
    toast('No image to send', 'e');
    return;
  }

  if (!S.activeUser && !S.activeGroup) {
    toast('Select a conversation first', 'e');
    closePastePreview();
    return;
  }

  var caption = $('paste-caption').value.trim();
  var formData = new FormData();
  formData.append('file', PasteState.file);

  if (S.isGroup && S.activeGroup) {
    formData.append('group_id', S.activeGroup.id);
  } else if (S.activeUser) {
    formData.append('receiver_id', S.activeUser.id);
  }

  if (caption) {
    formData.append('caption', caption);
  }

  toast('Sending image...', 'i');
  closePastePreview();

  fetch(API_URL + '/messages/upload/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + S.token
    },
    body: formData
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) {
        toast(data.error, 'e');
      } else {
        toast('Image sent!', 's');
      }
    })
    .catch(function (err) {
      toast('Failed to send image', 'e');
      console.error(err);
    });
}

// Global WebSocket for call signaling
function connectGlobalWS() {
  if (S.globalWs && S.globalWs.readyState === WebSocket.OPEN) return;

  var roomName = 'user_' + S.user.id;
  var ws = new WebSocket(WS_URL + roomName + '/?token=' + S.token);
  S.globalWs = ws;

  ws.onopen = function () {
    console.log('Global WS Connected for calls');
  };

  ws.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      // Handle call events from global WS
      if (data.type === 'call_incoming') {
        handleIncomingCall(data);
        showNotification(
          'Incoming ' + (data.call_type === 'video' ? 'Video' : 'Voice') + ' Call',
          data.caller_name + ' is calling...',
          data.caller_profile_picture || seed(data.caller_username || 'user'),
          function () { window.focus(); },
          true // isCall
        );
      } else if (data.type === 'call_accepted') {
        handleCallAccepted(data);
      } else if (data.type === 'call_rejected') {
        handleCallRejected(data);
      } else if (data.type === 'call_ended') {
        handleCallEnded(data);
      } else if (data.type === 'call_cancelled') {
        handleCallCancelled(data);
      } else if (data.type === 'call_ice') {
        handleIceCandidate(data);
      }
    } catch (err) { console.warn('Global WS error:', err); }
  };

  ws.onclose = function () {
    console.log('Global WS Disconnected, reconnecting...');
    setTimeout(connectGlobalWS, 3000);
  };

  ws.onerror = function () { ws.close(); };
}

// Load conversations
function loadConvs() {
  api('/conversations/').then(function (convs) {
    S.convs = convs || [];
    if (S.currentTab === 'chats') {
      renderConvList(S.convs);
    }
  }).catch(function () { toast('Failed to load chats', 'e'); });
}

// Load groups
function loadGroups() {
  api('/groups/').then(function (groups) {
    S.groups = groups || [];
    if (S.currentTab === 'groups') {
      renderGroupList(S.groups);
    }
  }).catch(function (e) {
    console.log('Groups not available:', e);
    S.groups = [];
  });
}

// Render conversation list
function renderConvList(items) {
  var el = $('conv-list');
  if (!items.length) {
    el.innerHTML = `<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">
      No chats yet. Click <i class="fa-solid fa-comment-medical"></i> to start one!
    </div>`;
    return;
  }
  el.innerHTML = items.map(function (item) {
    var u = item.user;
    var name = dname(u);
    var initials = ((u.first_name || u.username || 'U')[0] + (u.last_name ? u.last_name[0] : '')).toUpperCase();
    var last = item.last_message || 'No messages yet';
    var online = !!(u && u.is_online);
    var time = item.last_message_time ? fmtTime(item.last_message_time) : '';
    var act = S.activeUser && S.activeUser.id === (u && u.id);
    return `<div class="conv-item${act ? ' active' : ''}" data-uid="${u && u.id}" onclick="openChat(${u && u.id})">
      <div class="av-wrap">
        ${u.profile_picture ? `<img class="av-img av-52" src="${esc(u.profile_picture)}">` : `<div style="width:52px;height:52px;border-radius:50%;background:#1877f2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;">${initials}</div>`}
        <div class="sdot ${online ? 'on' : 'off'}"></div>
      </div>
      <div class="conv-body">
        <div class="conv-name">${esc(name)}</div>
        <div class="conv-prev">${esc(last)}</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${time}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.conv-item[data-uid]').forEach(function (item) {
    item.addEventListener('click', function () {
      openChat(parseInt(this.dataset.uid));
    });
    item.addEventListener('touchend', function (e) {
      e.preventDefault();
      openChat(parseInt(this.dataset.uid));
    });
  });
}


// Render group list
function renderGroupList(groups) {
  var el = $('conv-list');
  if (!groups.length) {
    el.innerHTML = `<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">
      No groups yet. Click <i class="fa-solid fa-comment-medical"></i> to create one!
    </div>`;
    return;
  }
  el.innerHTML = groups.map(function (g) {
    var act = S.activeGroup && S.activeGroup.id === g.id;
    var memberCount = g.members ? g.members.length : 0;
    return `<div class="conv-item group${act ? ' active' : ''}" data-gid="${g.id}" onclick="openGroup(${g.id})">
      <div class="group-icon">
        <i class="fa-solid fa-users"></i>
      </div>
      <div class="conv-body">
        <div class="conv-name">${esc(g.name)}</div>
        <div class="conv-prev">${memberCount} members</div>
      </div>
      <div class="conv-meta">
        <div class="conv-time">${g.last_message_time ? fmtTime(g.last_message_time) : ''}</div>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.conv-item[data-gid]').forEach(function (item) {
    item.addEventListener('click', function () {
      openGroup(parseInt(this.dataset.gid));
    });
    item.addEventListener('touchend', function (e) {
      e.preventDefault();
      openGroup(parseInt(this.dataset.gid));
    });
  });
}

function openChat(userId) {
  var user = null;
  for (var i = 0; i < S.convs.length; i++) {
    if (S.convs[i].user && S.convs[i].user.id === userId) {
      user = S.convs[i].user;
      break;
    }
  }
  if (!user) {
    for (var j = 0; j < S.allUsers.length; j++) {
      if (S.allUsers[j].id === userId) { user = S.allUsers[j]; break; }
    }
  }
  if (!user) { toast('User not found', 'e'); return; }

  S.activeUser = user;
  S.activeGroup = null;
  S.isGroup = false;

  connectWS(user.id);
  showChatView(user);
  loadMessages(userId);
  hlActive(userId, 'user');

  api('/start_conversation/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).catch(function () { });
}
// Load message history
function loadMessages(userId) {
  $('msg-area').innerHTML = '<div style="text-align:center;padding:20px;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  api('/messages/' + userId + '/').then(function (msgs) {
    $('msg-area').innerHTML = '';
    if (msgs && msgs.length) {
      var prevU = null;
      for (var i = 0; i < msgs.length; i++) {
        var consec = (msgs[i].username === prevU);
        appendMsg(msgs[i], consec);
        prevU = msgs[i].username;
      }
    }
  }).catch(function () {
    $('msg-area').innerHTML = '';
  });
}

// Open group chat
function openGroup(groupId) {
  var group = null;
  for (var i = 0; i < S.groups.length; i++) {
    if (S.groups[i].id === groupId) { group = S.groups[i]; break; }
  }
  if (!group) { toast('Group not found', 'e'); return; }

  S.activeGroup = group;
  S.activeUser = null;
  S.isGroup = true;
  showGroupView(group);
  loadGroupMessages(groupId);
  connectGroupWS(group.id);
  hlActive(groupId, 'group');
}

// Load group message history
function loadGroupMessages(groupId) {
  $('msg-area').innerHTML = '<div style="text-align:center;padding:20px;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  api('/groups/' + groupId + '/messages/').then(function (msgs) {
    $('msg-area').innerHTML = '';
    if (msgs && msgs.length) {
      var prevU = null;
      for (var i = 0; i < msgs.length; i++) {
        var consec = (msgs[i].username === prevU);
        appendMsg(msgs[i], consec);
        prevU = msgs[i].username;
      }
    }
  }).catch(function () {
    $('msg-area').innerHTML = '';
  });
}

// Show chat view
function showChatView(user) {
  $('empty-state').style.display = 'none';
  $('chat-view').classList.add('active');



  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('chat-panel').style.display = 'flex';
    document.getElementById('chat-panel').classList.add('active');
    document.getElementById('back-btn').style.display = 'flex';
  } else {
    document.getElementById('back-btn').style.display = 'none';
  }
  var name = dname(user);
  $('tb-name').textContent = name;
  if (user.profile_picture) {
    $('tb-av').src = user.profile_picture;
    $('tb-av').style.display = 'block';
  } else {
    $('tb-av').style.display = 'none';
    var oldInit = document.getElementById('tb-av-init');
    if (oldInit) oldInit.remove();
    var initials = ((user.first_name || user.username || 'U')[0] + (user.last_name ? user.last_name[0] : '')).toUpperCase();
    var div = document.createElement('div');
    div.id = 'tb-av-init';
    div.style.cssText = 'width:42px;height:42px;border-radius:50%;background:#1877f2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;';
    div.textContent = initials;
    $('tb-av').parentNode.insertBefore(div, $('tb-av'));
  }
  var dot = $('tb-dot'), sub = $('tb-sub');
  if (user.is_online) {
    dot.className = 'sdot on';
    sub.textContent = 'Online';
    sub.className = 'tb-sub online';
  } else {
    dot.className = 'sdot off';
    sub.textContent = lastSeenStr(user.last_seen);
    sub.className = 'tb-sub';
  }


  $('msg-area').innerHTML = '';
  updateSendBtn();
}

// Show group view
function showGroupView(group) {
  $('empty-state').style.display = 'none';
  $('chat-view').classList.add('active');

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('chat-panel').style.display = 'flex';
    document.getElementById('chat-panel').classList.add('active');
    document.getElementById('back-btn').style.display = 'flex';
  }
  $('tb-name').textContent = group.name;
  $('tb-av').src = seed(group.name);
  $('tb-dot').style.display = 'none';
  var memberCount = group.members ? group.members.length : 0;
  $('tb-sub').textContent = memberCount + ' members';
  $('tb-sub').className = 'tb-sub';
  $('msg-area').innerHTML = '';
  updateSendBtn();
}

// Highlight active conversation
function hlActive(id, type) {
  document.querySelectorAll('.conv-item').forEach(function (e) { e.classList.remove('active'); });
  var selector = type === 'group' ? '.conv-item[data-gid="' + id + '"]' : '.conv-item[data-uid="' + id + '"]';
  var el = document.querySelector(selector);
  if (el) el.classList.add('active');
}

// Generate message dropdown HTML
function msgDropdownHTML(msgId, msgText, isOut, timestamp, senderName) {
  var reactions = QUICK_REACTIONS.map(function (e) {
    return `<button class="msg-react-btn" onclick="reactToMsg('${msgId}','${e}')">${e}</button>`;
  }).join('');

  return `
    <button class="msg-dropdown-btn" onclick="toggleMsgDropdown(event, '${msgId}')">
      <i class="fa-solid fa-chevron-down"></i>
    </button>
    <div class="msg-dropdown" id="msg-drop-${msgId}">
      <div class="msg-dropdown-reactions">${reactions}</div>
      <div class="msg-drop-item" onclick="replyToMsg('${msgId}','${esc(msgText)}','${esc(senderName)}')">
        <i class="fa-solid fa-reply"></i> Reply
      </div>
      <div class="msg-drop-item" onclick="forwardMsg('${msgId}','${esc(msgText)}')">
        <i class="fa-solid fa-share"></i> Forward
      </div>
      <div class="msg-drop-item" onclick="copyMsg('${esc(msgText)}')">
        <i class="fa-regular fa-copy"></i> Copy
      </div>
      ${isOut ? `<div class="msg-drop-item" onclick="editMsg('${msgId}','${esc(msgText)}')">
        <i class="fa-solid fa-pen"></i> Edit
      </div>` : ''}
      ${isOut ? `<div class="msg-drop-item" onclick="showMsgInfo('${msgId}','${esc(msgText)}','${timestamp}')">
        <i class="fa-solid fa-circle-info"></i> Info
      </div>` : ''}
      <div class="msg-drop-item danger" onclick="deleteMsg('${msgId}')">
        <i class="fa-solid fa-trash"></i> Delete
      </div>
    </div>
  `;
}

// Toggle message dropdown
function toggleMsgDropdown(event, msgId) {
  event.stopPropagation();
  // Close all other dropdowns
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) {
    if (d.id !== 'msg-drop-' + msgId) d.classList.remove('show');
  });
  var dropdown = document.getElementById('msg-drop-' + msgId);
  if (dropdown) dropdown.classList.toggle('show');
}

// React to message
function reactToMsg(msgId, emoji) {
  api('/messages/' + msgId + '/react/', {
    method: 'POST',
    body: JSON.stringify({ emoji: emoji })
  }).then(function (data) {
    if (data && data.reactions) {
      updateMessageReactions(msgId, data.reactions);
      toast('Reacted with ' + emoji, 's');
    }
  });
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

// Reply to message
function replyToMsg(msgId, text, senderName) {
  S.replyTo = { id: msgId, text: text, sender: senderName || S.activeUser?.username || 'User' };

  // Show reply preview
  var preview = $('reply-preview');
  var replyName = $('reply-name');
  var replyText = $('reply-text');

  // Check if replying to own message
  if (S.replyTo.sender === S.user.username) {
    replyName.textContent = 'You';
  } else {
    replyName.textContent = S.replyTo.sender;
  }

  replyText.textContent = text.length > 60 ? text.substring(0, 60) + '...' : text;
  preview.classList.remove('hidden');

  $('msg-ta').focus();
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

// Cancel reply
function cancelReply() {
  S.replyTo = null;
  $('reply-preview').classList.add('hidden');
  $('msg-ta').placeholder = 'Type a message';
}

// Forward message
var ForwardState = {
  msgId: null,
  msgText: null
};

function forwardMsg(msgId, text) {
  ForwardState.msgId = msgId;
  ForwardState.msgText = text;

  // Show preview
  $('fwd-msg-preview').textContent = text.length > 100 ? text.substring(0, 100) + '...' : text;
  $('fwd-search').value = '';

  // Load user list
  loadForwardList();
  openM('fwd-modal');
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

function loadForwardList() {
  api('/all_users/').then(function (users) {
    renderForwardList(users || []);
  });
}

function searchForwardList(q) {
  api('/all_users/').then(function (users) {
    var filtered = (users || []).filter(function (u) {
      return u.username.toLowerCase().indexOf(q.toLowerCase()) !== -1 ||
        (u.first_name && u.first_name.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    });
    renderForwardList(filtered);
  });
}

function renderForwardList(users) {
  var el = $('fwd-list');
  if (!users.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--sub);">No contacts found</div>';
    return;
  }
  el.innerHTML = users.map(function (u) {
    var name = dname(u);
    var av = u.profile_picture || seed(u.username || name);
    return `<div class="user-row" onclick="sendForwardedMsg(${u.id})">
      <div class="av-wrap">
        <img class="av-img av-36" src="${esc(av)}">
        <div class="sdot ${u.is_online ? 'on' : 'off'}"></div>
      </div>
      <div>
        <div class="ur-name">${esc(name)}</div>
        <div class="ur-sub">@${esc(u.username)}</div>
      </div>
    </div>`;
  }).join('');
}

function sendForwardedMsg(userId) {
  if (!ForwardState.msgText) {
    toast('No message to forward', 'e');
    return;
  }

  // Start conversation and send
  api('/start_conversation/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).then(function (conv) {
    // Send the forwarded message
    var roomName = [S.user.id, userId].sort().join('_');
    var tempWs = new WebSocket(WS_URL + roomName + '/?token=' + S.token);

    tempWs.onopen = function () {
      tempWs.send(JSON.stringify({
        type: 'chat.message',
        message: ForwardState.msgText,
        receiver: conv.user.username,
        is_forwarded: true
      }));

      setTimeout(function () {
        tempWs.close();
        toast('Message forwarded!', 's');
        closeM('fwd-modal');
        ForwardState.msgId = null;
        ForwardState.msgText = null;
        loadConvs();
      }, 500);
    };

    tempWs.onerror = function () {
      toast('Failed to forward message', 'e');
    };
  }).catch(function () {
    toast('Failed to forward message', 'e');
  });
}

// Copy message
function copyMsg(text) {
  navigator.clipboard.writeText(text).then(function () {
    toast('Message copied', 's');
  }).catch(function () {
    toast('Failed to copy', 'e');
  });
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

// Show message info
function showMsgInfo(msgId, text, timestamp) {
  $('mi-text').textContent = text;
  $('mi-sent').textContent = fmtFullTime(timestamp);
  $('mi-delivered').textContent = '-';
  $('mi-seen').textContent = '-';
  openM('mi-modal');
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });

  // Fetch actual message info from server
  api('/messages/' + msgId + '/info/')
    .then(function (data) {
      if (data && data.sent_at) {
        $('mi-sent').textContent = fmtFullTime(data.sent_at);
        if (data.delivered_at) {
          $('mi-delivered').textContent = fmtFullTime(data.delivered_at);
        }
        if (data.read_at) {
          $('mi-seen').textContent = fmtFullTime(data.read_at);
        }
      }
    });
}

// Delete message
function deleteMsg(msgId) {
  toast('Delete coming soon', 'i');
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

// Edit message state
var EditState = {
  msgId: null,
  originalText: null
};

// Edit message - open modal
function editMsg(msgId, text) {
  EditState.msgId = msgId;
  EditState.originalText = text;
  $('edit-msg-input').value = text;
  openM('edit-msg-modal');
  setTimeout(function () { $('edit-msg-input').focus(); }, 100);
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
}

// Save edited message
function saveEditedMsg() {
  if (!EditState.msgId) {
    toast('No message selected', 'e');
    return;
  }

  var newText = $('edit-msg-input').value.trim();
  if (!newText) {
    toast('Message cannot be empty', 'e');
    return;
  }

  if (newText === EditState.originalText) {
    closeM('edit-msg-modal');
    EditState.msgId = null;
    EditState.originalText = null;
    return;
  }

  var msgId = EditState.msgId; // Save locally before async call

  api('/messages/' + msgId + '/edit/', {
    method: 'POST',
    body: JSON.stringify({ message: newText })
  }).then(function (data) {
    if (data && data.success) {
      // Update message in UI
      var msgRow = document.getElementById('msg-' + msgId);
      if (msgRow) {
        var msgTextEl = msgRow.querySelector('.msg-text');
        if (msgTextEl) {
          msgTextEl.innerHTML = esc(newText);
          // Add edited indicator
          if (!msgRow.querySelector('.msg-edited')) {
            var footer = msgRow.querySelector('.msg-footer');
            if (footer) {
              var editedSpan = document.createElement('span');
              editedSpan.className = 'msg-edited';
              editedSpan.textContent = 'edited';
              footer.insertBefore(editedSpan, footer.firstChild);
            }
          }
        }
      }
      toast('Message edited', 's');
      closeM('edit-msg-modal');
      EditState.msgId = null;
      EditState.originalText = null;
    } else {
      toast(data.error || 'Failed to edit', 'e');
    }
  }).catch(function (err) {
    console.error('Edit error:', err);
    toast('Failed to edit message', 'e');
  });
}

// Append message to chat
function appendMsg(msg, consec) {
  var area = $('msg-area');
  var me = msg.username === S.user.username;
  var content = msg.message || '';
  var isRead = msg.is_read || false;
  var tick = me ? tickSVG(isRead ? 'read' : 'delivered') : '';
  var msgId = msg.id || 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  var senderName = msg.display_name || msg.username || 'User';
  var msgType = msg.message_type || 'text';
  var isForwarded = msg.is_forwarded || false;
  var replyData = msg.reply_data || null;

  // Build forwarded label
  var forwardedLabel = '';
  if (isForwarded) {
    forwardedLabel = '<div class="msg-forwarded"><i class="fa-solid fa-share"></i> Forwarded</div>';
  }

  // Build reply quote block
  var replyQuote = '';
  if (replyData && replyData.text) {
    var replySender = replyData.sender || 'User';
    var replyText = replyData.text.length > 80 ? replyData.text.substring(0, 80) + '...' : replyData.text;
    replyQuote = '<div class="msg-reply-quote"><div class="reply-sender">' + esc(replySender) + '</div><div class="reply-text">' + esc(replyText) + '</div></div>';
  }

  // Build message content based on type
  var msgContent = '';
  if (msgType === 'image' && msg.file_url) {
    msgContent = `<div class="img-msg" onclick="openMedia('${esc(msg.file_url)}', 'image')">
      <img src="${esc(msg.file_url)}" alt="Image">
    </div>`;
  } else if (msgType === 'video' && msg.file_url) {
    msgContent = `<div class="img-msg" onclick="openMedia('${esc(msg.file_url)}', 'video')">
      <video src="${esc(msg.file_url)}" preload="metadata"></video>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.5);border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;">
        <i class="fa-solid fa-play" style="color:#fff;font-size:18px;"></i>
      </div>
    </div>`;
  } else if (msgType === 'voice' && msg.file_url) {
    var dur = msg.duration || 0;
    var mins = Math.floor(dur / 60);
    var secs = dur % 60;
    var duration = mins + ':' + (secs < 10 ? '0' : '') + secs;
    var waveform = '';
    for (var w = 0; w < 28; w++) {
      var h = Math.floor(Math.random() * 16) + 4;
      waveform += '<span class="wave-bar" style="height:' + h + 'px;"></span>';
    }
    msgContent = `<div class="voice-bubble" data-src="${esc(msg.file_url)}" data-duration="${dur}">
      <img class="voice-avatar" src="${seed(senderName)}" alt="">
      <button class="voice-play" onclick="playVoice(this)">
        <i class="fa-solid fa-play"></i>
      </button>
      <div class="voice-progress">
        <div class="voice-waveform">${waveform}</div>
        <span class="voice-duration">${duration}</span>
      </div>
    </div>`;
  } else if ((msgType === 'file' || msgType === 'audio') && msg.file_url) {
    var fname = msg.file_name || 'File';
    var fsize = formatFileSize(msg.file_size || 0);
    var iconClass = getFileIconClass(fname);
    var fileIcon = getFileIcon(fname);
    var canPreview = canPreviewFile(fname);

    msgContent = `<div class="file-msg-wrap">
      <div class="file-msg-info" onclick="openFilePreview('${esc(msg.file_url)}', '${esc(fname)}')">
        <div class="file-icon ${iconClass}"><i class="fa-solid ${fileIcon}"></i></div>
        <div class="file-info">
          <div class="file-name">${esc(fname)}</div>
          <div class="file-size">${fsize}</div>
        </div>
      </div>
      <div class="file-msg-buttons">
        ${canPreview ? `<button class="file-btn open-btn" onclick="openFilePreview('${esc(msg.file_url)}', '${esc(fname)}')"><i class="fa-solid fa-eye"></i> Open</button>` : ''}
        <button class="file-btn download-btn" onclick="downloadFile('${esc(msg.file_url)}', '${esc(fname)}')"><i class="fa-solid fa-download"></i> Download</button>
      </div>
    </div>`;
  } else {
    msgContent = `<div class="msg-text">${esc(content)}</div>`;
  }

  // Build reactions HTML
  var reactionsHtml = buildReactionsHtml(msg.reactions || {}, msgId);
  var hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;

  var row = document.createElement('div');
  row.className = 'msg-row ' + (me ? 'out' : 'in') + (consec ? ' consec' : '') + (hasReactions ? ' has-reactions' : '');
  row.id = 'msg-' + msgId;
  row.innerHTML = `
    ${msgDropdownHTML(msgId, content, me, msg.timestamp, senderName)}
    <div class="bubble" style="position:relative;">
      ${forwardedLabel}
      ${replyQuote}
      ${msgContent}
      <div class="msg-footer">
        <span class="msg-time">${fmtTime(msg.timestamp)}</span>${tick}
      </div>
      ${reactionsHtml}
    </div>
  `;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  // Mark message as read if from other user
  if (!me && msg.id) {
    markMessageRead(msg.id);
  }
}

function buildReactionsHtml(reactions, msgId) {
  if (!reactions || Object.keys(reactions).length === 0) return '';
  var html = '<div class="msg-reactions">';
  for (var emoji in reactions) {
    var count = reactions[emoji].count || 1;
    html += `<span class="reaction-badge" onclick="showReactionUsers(${msgId}, '${emoji}')">${emoji}${count > 1 ? '<span class="reaction-count">' + count + '</span>' : ''}</span>`;
  }
  html += '</div>';
  return html;
}

function getFileIcon(filename) {
  var ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'fa-file-pdf';
  if (['xls', 'xlsx'].includes(ext)) return 'fa-file-excel';
  if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
  if (['ppt', 'pptx'].includes(ext)) return 'fa-file-powerpoint';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'fa-file-image';
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'fa-file-video';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'fa-file-audio';
  if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-zipper';
  return 'fa-file';
}

function getFileIconClass(filename) {
  var ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  return '';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function markMessageRead(msgId) {
  api('/messages/' + msgId + '/read/', { method: 'POST' })
    .then(function (res) {
      if (res && res.is_read) {
        // Update UI to show blue tick for sender
        notifyMessageRead(msgId);
      }
    });
}

function notifyMessageRead(msgId) {
  // Send read receipt via WebSocket
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({
      type: 'message_read',
      message_id: msgId
    }));
  }
}

// Send button management
function updateSendBtn() {
  var has = ($('msg-ta') && $('msg-ta').value.trim().length > 0);
  $('send-btn').disabled = !has;
  // Toggle input row class for mic/send button visibility
  var inputRow = document.querySelector('.input-row');
  if (inputRow) {
    inputRow.classList.toggle('has-text', has);
  }
}

function doSend() { sendText(); }

function sendText() {
  var ta = $('msg-ta');
  var txt = ta.value.trim();
  if (!txt || !S.ws || S.ws.readyState !== WebSocket.OPEN) return;

  var msgData = {
    type: 'chat.message',
    message: txt
  };

  if (S.isGroup && S.activeGroup) {
    msgData.group_id = S.activeGroup.id;
  } else if (S.activeUser) {
    msgData.receiver = S.activeUser.username;
  }

  if (S.replyTo) {
    msgData.reply_to = S.replyTo.id;
    cancelReply();
  }

  S.ws.send(JSON.stringify(msgData));
  ta.value = '';
  ta.style.height = 'auto';
  updateSendBtn();
}

// ═══════════════════════════════════════════════════════════════
// FILE UPLOAD
// ═══════════════════════════════════════════════════════════════
function handleFileSelect(e) {
  var files = e.target.files;
  if (!files || files.length === 0) return;

  for (var i = 0; i < files.length; i++) {
    uploadFile(files[i]);
  }
  e.target.value = '';
}

function uploadFile(file) {
  if (!S.activeUser) {
    toast('Select a conversation first', 'e');
    return;
  }

  // Check file size (50MB max)
  if (file.size > 52428800) {
    toast('File too large (max 50MB)', 'e');
    return;
  }

  var formData = new FormData();
  formData.append('file', file);
  formData.append('receiver_id', S.activeUser.id);

  // Show upload progress
  toast('Uploading ' + file.name + '...', 's');

  fetch(API_URL + '/messages/upload/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + S.token
    },
    body: formData
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) {
        toast(data.error, 'e');
      } else {
        toast('File sent!', 's');
        // Message will be broadcast via WebSocket
      }
    })
    .catch(function (err) {
      toast('Upload failed', 'e');
      console.error(err);
    });
}

// ═══════════════════════════════════════════════════════════════
// VOICE RECORDING
// ═══════════════════════════════════════════════════════════════
var VoiceState = {
  isRecording: false,
  mediaRecorder: null,
  chunks: [],
  startTime: null,
  timerInterval: null,
  stream: null,
  shouldSend: false
};

function startVoiceRecord() {
  if (VoiceState.isRecording) return;

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function (stream) {
      VoiceState.isRecording = true;
      VoiceState.chunks = [];
      VoiceState.stream = stream;
      VoiceState.mediaRecorder = new MediaRecorder(stream);

      VoiceState.mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) {
          VoiceState.chunks.push(e.data);
        }
      };

      VoiceState.mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        // Send voice after recorder fully stops
        if (VoiceState.chunks.length > 0 && VoiceState.shouldSend) {
          doSendVoice();
        }
        VoiceState.shouldSend = false;
      };

      // Collect data every 100ms
      VoiceState.mediaRecorder.start(100);
      VoiceState.startTime = Date.now();

      // Show recording UI
      $('voice-record').classList.remove('hidden');
      document.querySelector('.input-row').style.display = 'none';

      // Start timer
      VoiceState.timerInterval = setInterval(updateVoiceTimer, 1000);
      updateVoiceTimer();
    })
    .catch(function (err) {
      toast('Could not access microphone', 'e');
      console.error(err);
    });
}

function stopVoiceRecord() {
  if (!VoiceState.isRecording || !VoiceState.mediaRecorder) return;

  VoiceState.shouldSend = true;
  VoiceState.mediaRecorder.stop();
  VoiceState.isRecording = false;
}

function cancelVoice() {
  VoiceState.shouldSend = false;
  if (VoiceState.mediaRecorder && VoiceState.mediaRecorder.state !== 'inactive') {
    VoiceState.mediaRecorder.stop();
  }
  VoiceState.isRecording = false;
  VoiceState.chunks = [];
  clearInterval(VoiceState.timerInterval);

  $('voice-record').classList.add('hidden');
  document.querySelector('.input-row').style.display = 'flex';
}

// Called from send button in voice recording UI
function sendVoice() {
  if (!VoiceState.mediaRecorder || VoiceState.mediaRecorder.state === 'inactive') {
    cancelVoice();
    return;
  }
  VoiceState.shouldSend = true;
  VoiceState.mediaRecorder.stop();
}

// Actual send logic - called from onstop handler
function doSendVoice() {
  if (VoiceState.chunks.length === 0 || !S.activeUser) {
    cancelVoice();
    return;
  }

  var duration = Math.floor((Date.now() - VoiceState.startTime) / 1000);
  var blob = new Blob(VoiceState.chunks, { type: 'audio/webm' });

  var formData = new FormData();
  formData.append('file', blob, 'voice_' + Date.now() + '.webm');
  formData.append('receiver_id', S.activeUser.id);
  formData.append('duration', duration);

  // Reset UI
  clearInterval(VoiceState.timerInterval);
  $('voice-record').classList.add('hidden');
  document.querySelector('.input-row').style.display = 'flex';
  VoiceState.isRecording = false;
  VoiceState.chunks = [];

  fetch(API_URL + '/messages/voice/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + S.token
    },
    body: formData
  })
    .then(function (res) {
      if (!res.ok) {
        console.error('Voice upload failed:', res.status, res.statusText);
        return res.json().then(function (data) {
          throw new Error(data.error || 'Upload failed');
        });
      }
      return res.json();
    })
    .then(function (data) {
      if (data && data.error) {
        toast(data.error, 'e');
      } else {
        toast('Voice message sent', 's');
      }
      // Message will appear via WebSocket broadcast
    })
    .catch(function (err) {
      toast('Failed to send voice message: ' + err.message, 'e');
      console.error('Voice send error:', err);
    });
}

function updateVoiceTimer() {
  if (!VoiceState.startTime) return;
  var elapsed = Math.floor((Date.now() - VoiceState.startTime) / 1000);
  var mins = Math.floor(elapsed / 60);
  var secs = elapsed % 60;
  $('voice-timer').textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// Play voice message
var currentVoiceAudio = null;
function playVoice(btn) {
  var bubble = btn.closest('.voice-bubble');
  var src = bubble.dataset.src;
  var icon = btn.querySelector('i');
  var bars = bubble.querySelectorAll('.wave-bar');
  var durationEl = bubble.querySelector('.voice-duration');
  var totalDuration = parseFloat(bubble.dataset.duration) || 0;

  if (currentVoiceAudio && currentVoiceAudio.src === src && !currentVoiceAudio.paused) {
    currentVoiceAudio.pause();
    icon.className = 'fa-solid fa-play';
    bubble.classList.remove('playing');
    return;
  }

  if (currentVoiceAudio) {
    currentVoiceAudio.pause();
    document.querySelectorAll('.voice-play i').forEach(function (i) { i.className = 'fa-solid fa-play'; });
    document.querySelectorAll('.voice-bubble').forEach(function (b) { b.classList.remove('playing'); });
  }

  currentVoiceAudio = new Audio(src);
  currentVoiceAudio.play();
  icon.className = 'fa-solid fa-pause';
  bubble.classList.add('playing');

  currentVoiceAudio.ontimeupdate = function () {
    var pct = currentVoiceAudio.currentTime / currentVoiceAudio.duration;
    var playedBars = Math.floor(pct * bars.length);
    bars.forEach(function (bar, idx) {
      bar.classList.toggle('played', idx < playedBars);
    });
    // Update duration display
    var remaining = currentVoiceAudio.duration - currentVoiceAudio.currentTime;
    var mins = Math.floor(remaining / 60);
    var secs = Math.floor(remaining % 60);
    durationEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
  };

  currentVoiceAudio.onended = function () {
    icon.className = 'fa-solid fa-play';
    bubble.classList.remove('playing');
    bars.forEach(function (bar) { bar.classList.remove('played'); });
    // Reset duration
    var mins = Math.floor(totalDuration / 60);
    var secs = Math.floor(totalDuration % 60);
    durationEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
  };
}

// ═══════════════════════════════════════════════════════════════
// REACTIONS
// ═══════════════════════════════════════════════════════════════
function updateMessageReactions(msgId, reactions) {
  var row = document.getElementById('msg-' + msgId);
  if (!row) return;

  var bubble = row.querySelector('.bubble');
  var existing = bubble.querySelector('.msg-reactions');
  if (existing) existing.remove();

  var html = buildReactionsHtml(reactions, msgId);
  if (html) {
    bubble.insertAdjacentHTML('beforeend', html);
    row.classList.add('has-reactions');
  } else {
    row.classList.remove('has-reactions');
  }
}

function showReactionUsers(msgId, emoji) {
  api('/messages/' + msgId + '/info/')
    .then(function (data) {
      if (data && data.reactions && data.reactions[emoji]) {
        var users = data.reactions[emoji].users.join(', ');
        toast(emoji + ' by ' + users, 's');
      }
    });
}

// Media preview state
var MediaState = {
  url: null,
  filename: null,
  type: null
};

// Open media viewer with proper modal
function openMedia(url, type) {
  MediaState.url = url;
  MediaState.type = type;
  MediaState.filename = url.split('/').pop() || 'media';

  var overlay = $('media-preview');
  var content = $('media-preview-content');
  var title = $('media-preview-title');

  title.textContent = MediaState.filename;

  if (type === 'image') {
    content.innerHTML = '<img src="' + esc(url) + '" alt="Preview">';
  } else if (type === 'video') {
    content.innerHTML = '<video src="' + esc(url) + '" controls autoplay></video>';
  }

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// Close media preview
function closeMediaPreview(e) {
  if (e && e.target !== $('media-preview') && !e.target.closest('.media-action-btn')) return;
  var overlay = $('media-preview');
  overlay.classList.remove('active');
  $('media-preview-content').innerHTML = '';
  document.body.style.overflow = '';
}

// Download current media
function downloadMedia() {
  if (MediaState.url) {
    downloadFile(MediaState.url, MediaState.filename);
  }
}

// Open media in new tab
function openMediaInNewTab() {
  if (MediaState.url) {
    window.open(MediaState.url, '_blank');
  }
}

// Download file helper
function downloadFile(url, filename) {
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || url.split('/').pop() || 'file';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Check if file can be previewed
function canPreviewFile(filename) {
  var ext = filename.split('.').pop().toLowerCase();
  return ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg'].includes(ext);
}

// Open file preview for documents
function openFilePreview(url, filename) {
  var ext = filename.split('.').pop().toLowerCase();

  // Images
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    openMedia(url, 'image');
    return;
  }

  // Videos
  if (['mp4', 'webm', 'ogg'].includes(ext)) {
    openMedia(url, 'video');
    return;
  }

  // PDFs - use browser viewer or Google Docs
  if (ext === 'pdf') {
    MediaState.url = url;
    MediaState.filename = filename;
    MediaState.type = 'pdf';

    var overlay = $('media-preview');
    var content = $('media-preview-content');
    var title = $('media-preview-title');

    title.textContent = filename;
    // Try direct PDF embed first, fallback to Google Docs viewer
    content.innerHTML = '<iframe src="' + esc(url) + '#toolbar=1" type="application/pdf"></iframe>';

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }

  // Excel, Word, etc - open in new tab or download
  window.open(url, '_blank');
}

// Input handlers
function onInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  updateSendBtn();
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
  if (e.key === 'Escape' && S.replyTo) {
    cancelReply();
  }
}

// WebSocket connection for user chat
function connectWS(otherUserId) {
  var roomName = [S.user.id, otherUserId].sort().join('_');

  console.log('Connecting WS room:', roomName); // debug

  if (S.ws && S.wsRoom === roomName && S.ws.readyState === WebSocket.OPEN) {
    console.log('Already connected to:', roomName);
    return;
  }

  if (S.ws) {
    S.ws.onclose = null;
    S.ws.close();
  }

  S.wsRoom = roomName;
  var ws = new WebSocket(WS_URL + roomName + '/?token=' + S.token);
  S.ws = ws;

  ws.onopen = function () {
    console.log('✅ Chat WS Connected:', roomName);
  };

  ws.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      console.log('📩 Message received:', data);
      handleWS(data);
    } catch (err) {
      console.warn('WS parse error:', err);
    }
  };

  ws.onclose = function (e) {
    console.log('❌ WS Disconnected, code:', e.code, 'reason:', e.reason);
  };

  ws.onerror = function (e) {
    console.error('🔴 WS Error:', e);
  };
}
// ═══════════════════════════════════════════════════════════════
// WEBSOCKET MESSAGE HANDLER - Real-time messages
// ═══════════════════════════════════════════════════════════════
function handleWS(data) {
  var type = data.type;

  if (type === 'chat.message') {
    var me = data.username === S.user.username;

    // Append message to chat
    appendMsg({
      id: data.message_id,
      message: data.message,
      username: data.username,
      display_name: data.display_name,
      profile_picture: data.profile_picture,
      timestamp: data.timestamp,
      reply_to: data.reply_to,
      reply_data: data.reply_data,
      is_forwarded: data.is_forwarded || false,
      message_type: 'text'
    }, false);

    // Update sidebar preview
    updateSidebarPreview(data);

    // Reload conversation list to update order
    loadConvs();

    // Show notification if message is from someone else
    if (!me) {
      var senderName = data.display_name || data.username || 'Someone';
      var avatar = data.profile_picture || seed(data.username || 'user');
      showNotifPopup({
        username: senderName,
        message: data.message,
        profile_picture: avatar
      });
      showNotification(
        senderName,
        data.message,
        avatar,
        function () { window.focus(); },
        false
      );
    }
  }

  else if (type === 'voice_message') {
    appendMsg({
      id: data.message_id,
      message: data.message || '',
      username: data.username,
      display_name: data.display_name,
      timestamp: data.timestamp,
      message_type: 'voice',
      file_url: data.file_url,
      file_name: data.file_name,
      duration: data.duration || 0
    }, false);
    loadConvs();
  }

  else if (type === 'user.join') {
    console.log(data.username + ' joined the chat');
  }

  else if (type === 'user.leave') {
    console.log(data.username + ' left the chat');
  }

  else if (type === 'message_read') {
    updateMessageTick(data.message_id, 'read');
  }
}

// WebSocket connection for group chat
function connectGroupWS(groupId) {
  var roomName = 'group_' + groupId;
  if (S.ws && S.wsRoom === roomName && S.ws.readyState === WebSocket.OPEN) return;
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  S.wsRoom = roomName;
  var ws = new WebSocket(WS_URL + roomName + '/?token=' + S.token);
  S.ws = ws;
  ws.onopen = function () { console.log('Group WS Connected'); };
  ws.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      handleWS(data);
    } catch (err) { console.warn(err); }
  };
  ws.onclose = function () { console.log('Group WS Disconnected'); };
  ws.onerror = function () { ws.close(); };
}




// Update message tick to read
function updateMessageTick(msgId, status) {
  var row = document.getElementById('msg-' + msgId);
  if (row) {
    var ticks = row.querySelector('.msg-ticks');
    if (ticks && status === 'read') {
      ticks.classList.add('read');
    }
  }
}

// Update sidebar preview
function updateSidebarPreview(msg) {
  if (S.isGroup && S.activeGroup) {
    var el = document.querySelector('.conv-item[data-gid="' + S.activeGroup.id + '"] .conv-prev');
    if (el) el.textContent = msg.message;
  } else if (S.activeUser) {
    var el = document.querySelector('.conv-item[data-uid="' + S.activeUser.id + '"] .conv-prev');
    if (el) el.textContent = msg.message;
    var time = document.querySelector('.conv-item[data-uid="' + S.activeUser.id + '"] .conv-time');
    if (time) time.textContent = fmtTime(msg.timestamp);
  }
}

// Search functionality
var srchT;
function handleSearch(q) {
  if (!q) {
    if (S.currentTab === 'chats') loadConvs();
    else loadGroups();
    return;
  }
  clearTimeout(srchT);
  srchT = setTimeout(function () {
    if (S.currentTab === 'chats') {
      var filtered = S.convs.filter(function (c) {
        var u = c.user;
        if (!u) return false;
        return (u.username && u.username.toLowerCase().indexOf(q.toLowerCase()) !== -1) ||
          (u.first_name && u.first_name.toLowerCase().indexOf(q.toLowerCase()) !== -1) ||
          (u.last_name && u.last_name.toLowerCase().indexOf(q.toLowerCase()) !== -1);
      });
      renderConvList(filtered);
    } else {
      var filtered = S.groups.filter(function (g) {
        return g.name && g.name.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      });
      renderGroupList(filtered);
    }
  }, 350);
}

// New chat modal
function openNewChat() {
  if (S.currentTab === 'groups') {
    // Open create group modal
    openM('cg-modal');
    $('cg-name').value = '';
    $('cg-srch').value = '';
    S.selectedGroupUsers = [];
    updateSelectedUsers();
    loadGroupUsersList();
  } else {
    openM('nc-modal');
    $('nc-srch').value = '';
    loadNCList();
  }
}

function loadNCList() {
  api('/all_users/').then(function (users) {
    S.allUsers = users || [];
    var el = $('nc-list');
    el.innerHTML = users.map(function (u) {
      var name = dname(u);
      var av = u.profile_picture || seed(u.username || name);
      var online = !!u.is_online;
      return `<div class="user-row" onclick="startNewChat(${u.id})">
        <div class="av-wrap">
          <img class="av-img av-36" src="${esc(av)}">
          <div class="sdot ${online ? 'on' : 'off'}"></div>
        </div>
        <div>
          <div class="ur-name">${esc(name)}</div>
          <div class="ur-sub">@${esc(u.username)}</div>
        </div>
      </div>`;
    }).join('') || '<div style="padding:14px;text-align:center;color:var(--sub);">No users found</div>';
  });
}

function searchNC(q) {
  api('/all_users/').then(function (users) {
    var filtered = users.filter(function (u) {
      return u.username.toLowerCase().indexOf(q.toLowerCase()) !== -1 ||
        (u.first_name && u.first_name.toLowerCase().indexOf(q.toLowerCase()) !== -1);
    });
    var el = $('nc-list');
    el.innerHTML = filtered.map(function (u) {
      var name = dname(u);
      var av = u.profile_picture || seed(u.username || name);
      return `<div class="user-row" onclick="startNewChat(${u.id})">
        <div class="av-wrap">
          <img class="av-img av-36" src="${esc(av)}">
          <div class="sdot ${u.is_online ? 'on' : 'off'}"></div>
        </div>
        <div>
          <div class="ur-name">${esc(name)}</div>
          <div class="ur-sub">@${esc(u.username)}</div>
        </div>
      </div>`;
    }).join('') || '<div style="padding:14px;text-align:center;color:var(--sub);">No users found</div>';
  });
}

function startNewChat(uid) {
  closeM('nc-modal');
  openChat(uid);
  loadConvs();
}

// Group creation functions
function loadGroupUsersList() {
  api('/all_users/').then(function (users) {
    S.allUsers = users || [];
    renderGroupUsersList(users);
  });
}

function renderGroupUsersList(users) {
  var el = $('cg-list');
  el.innerHTML = users.map(function (u) {
    var name = dname(u);
    var av = u.profile_picture || seed(u.username || name);
    var isSelected = S.selectedGroupUsers.some(function (su) { return su.id === u.id; });
    return `<div class="user-row ${isSelected ? 'selected' : ''}" onclick="toggleGroupUser(${u.id})">
      <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation()">
      <div class="av-wrap">
        <img class="av-img av-36" src="${esc(av)}">
      </div>
      <div>
        <div class="ur-name">${esc(name)}</div>
        <div class="ur-sub">@${esc(u.username)}</div>
      </div>
    </div>`;
  }).join('') || '<div style="padding:14px;text-align:center;color:var(--sub);">No users found</div>';
}

function searchGroupUsers(q) {
  var filtered = S.allUsers.filter(function (u) {
    return u.username.toLowerCase().indexOf(q.toLowerCase()) !== -1 ||
      (u.first_name && u.first_name.toLowerCase().indexOf(q.toLowerCase()) !== -1);
  });
  renderGroupUsersList(filtered);
}

function toggleGroupUser(userId) {
  var user = S.allUsers.find(function (u) { return u.id === userId; });
  if (!user) return;

  var idx = S.selectedGroupUsers.findIndex(function (u) { return u.id === userId; });
  if (idx >= 0) {
    S.selectedGroupUsers.splice(idx, 1);
  } else {
    S.selectedGroupUsers.push(user);
  }

  updateSelectedUsers();
  renderGroupUsersList(S.allUsers);
}

function updateSelectedUsers() {
  var el = $('cg-selected');
  el.innerHTML = S.selectedGroupUsers.map(function (u) {
    return `<span style="background:var(--blue-lt);color:var(--blue);padding:4px 10px;border-radius:20px;font-size:12px;display:flex;align-items:center;gap:6px;">
      ${esc(dname(u))}
      <i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="toggleGroupUser(${u.id})"></i>
    </span>`;
  }).join('');
}

function createGroup() {
  var name = $('cg-name').value.trim();
  if (!name) {
    toast('Please enter a group name', 'e');
    return;
  }
  if (S.selectedGroupUsers.length < 1) {
    toast('Please select at least 1 member', 'e');
    return;
  }

  var memberIds = S.selectedGroupUsers.map(function (u) { return u.id; });

  api('/groups/create/', {
    method: 'POST',
    body: JSON.stringify({
      name: name,
      members: memberIds
    })
  }).then(function (group) {
    if (group) {
      toast('Group created!', 's');
      closeM('cg-modal');
      loadGroups();
      openGroup(group.id);
    }
  }).catch(function () {
    toast('Failed to create group', 'e');
  });
}

// Tab switching
function swTab(tab, btn) {
  S.currentTab = tab;
  document.querySelectorAll('.sb-tab').forEach(function (b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');

  $('search-inp').value = '';

  if (tab === 'chats') {
    loadConvs();
  } else if (tab === 'groups') {
    loadGroups();
  } else if (tab === 'calls') {
    loadCallHistory();
  }
}

// Load call history
// Load call history
function loadCallHistory() {
  api('/call_history/').then(function (calls) {
    renderCallHistory(calls || []);
  }).catch(function (err) {
    console.error('Call history error:', err);
    renderCallHistory([]);
  });
}

function renderCallHistory(calls) {
  var el = $('conv-list');

  if (!calls || !calls.length) {
    el.innerHTML = `
      <div class="empty-calls">
        <i class="fa-solid fa-phone-slash"></i>
        <h4>No calls yet</h4>
        <p>Start a conversation and make your first call!</p>
      </div>`;
    return;
  }

  el.innerHTML = calls.map(function (call) {
    var user = call.other_user;
    if (!user) return '';

    // ── Name: username fallback ──────────────────────────────
    var name = '';
    if (user.first_name && user.first_name.trim()) {
      name = user.first_name.trim();
      if (user.last_name && user.last_name.trim()) {
        name += ' ' + user.last_name.trim();
      }
    } else if (user.username) {
      name = user.username;
    } else {
      name = 'Unknown';
    }

    // ── Avatar ───────────────────────────────────────────────
    var av = user.profile_picture || null;
    var initial = (name[0] || 'U').toUpperCase();

    // ── Status flags ─────────────────────────────────────────
    var isOutgoing = !!call.is_outgoing;
    var status = call.status || '';
    var isVideo = call.call_type === 'video';

    var isCompleted = status === 'completed' || status === 'accepted';
    var isMissed = !isOutgoing && (status === 'missed' || status === 'rejected' || status === 'pending');
    var isCancelled = isOutgoing && (status === 'cancelled' || status === 'missed' || status === 'pending');

    // ── Arrow icon + colour + label ──────────────────────────
    var arrowIcon, arrowColor, statusLabel;

    if (isOutgoing) {
      arrowIcon = 'fa-arrow-up-right';
      arrowColor = isCancelled ? '#f15c6d' : '#25d366';
      statusLabel = isVideo
        ? (isCancelled ? 'Cancelled video call' : 'Outgoing video call')
        : (isCancelled ? 'Cancelled voice call' : 'Outgoing voice call');
    } else if (isMissed) {
      arrowIcon = 'fa-arrow-down-left';
      arrowColor = '#f15c6d';
      statusLabel = isVideo ? 'Missed video call' : 'Missed voice call';
    } else {
      arrowIcon = 'fa-arrow-down-left';
      arrowColor = '#25d366';
      statusLabel = isVideo ? 'Incoming video call' : 'Incoming voice call';
    }

    // ── Time string ──────────────────────────────────────────
    var callDate = new Date(call.created_at);
    var now = new Date();
    var yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    var timeStr;

    if (callDate.toDateString() === now.toDateString()) {
      timeStr = callDate.toLocaleTimeString('en-PK', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: PKT
      });
    } else if (callDate.toDateString() === yesterday.toDateString()) {
      timeStr = 'Yesterday';
    } else {
      timeStr = callDate.toLocaleDateString('en-PK', {
        day: 'numeric', month: 'short', timeZone: PKT
      });
    }

    // ── Duration ─────────────────────────────────────────────
    var durationStr = '';
    if (call.duration && call.duration > 0) {
      var dm = Math.floor(call.duration / 60);
      var ds = call.duration % 60;
      durationStr = ' (' + dm + ':' + (ds < 10 ? '0' : '') + ds + ')';
    }

    var callIcon = isVideo ? 'fa-video' : 'fa-phone';

    return `
      <div class="call-item" onclick="callUser(${user.id}, '${call.call_type}')">

        <!-- Avatar -->
        <div class="call-av-wrap">
          ${av
        ? `<img class="call-av" src="${esc(av)}" alt="${esc(name)}">`
        : `<div class="call-av-init">${initial}</div>`
      }
        </div>

        <!-- Name + status -->
        <div class="call-info">
          <div class="call-user-name ${isMissed ? 'missed' : ''}">${esc(name)}</div>
          <div class="call-meta">
            <i class="fa-solid ${arrowIcon}" style="color:${arrowColor}; font-size:11px;"></i>
            <span class="call-status-text ${isMissed ? 'missed-text' : ''}">
              ${esc(statusLabel)}${durationStr}
            </span>
          </div>
        </div>

        <!-- Time + action button -->
        <div class="call-right">
          <div class="call-time">${timeStr}</div>
          <button
            class="call-action-btn ${isVideo ? 'video' : 'voice'}"
            onclick="event.stopPropagation(); callUser(${user.id}, '${call.call_type}')"
            title="${isVideo ? 'Video call' : 'Voice call'}">
            <i class="fa-solid ${callIcon}"></i>
          </button>
        </div>

      </div>`;
  }).join('');
}

// Call user from history
function callUser(userId, callType) {
  // Find user in convs or fetch
  var user = null;
  for (var i = 0; i < S.convs.length; i++) {
    if (S.convs[i].user && S.convs[i].user.id === userId) {
      user = S.convs[i].user;
      break;
    }
  }

  if (user) {
    S.activeUser = user;
    startCall(callType);
  } else {
    // Start conversation first
    api('/start_conversation/', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId })
    }).then(function (res) {
      S.activeUser = res.user;
      startCall(callType);
    }).catch(function () {
      toast('Could not start call', 'e');
    });
  }
}

// Profile modal
function openProfile() {
  api('/profile/').then(function (profile) {
    var initial = (profile.first_name || profile.username || 'U')[0].toUpperCase();

    // Profile modal avatar update
    var pfAv = $('pf-av');
    var pfAvInit = $('pf-av-init');
    var removeBtn = $('remove-photo-btn');

    if (profile.profile_picture) {
      // Photo hai
      pfAv.src = profile.profile_picture + '?t=' + Date.now();
      pfAv.style.display = 'block';
      pfAvInit.style.display = 'none';
      if (removeBtn) removeBtn.style.display = 'flex';
    } else {
      // No photo - letter show karo
      pfAv.style.display = 'none';
      pfAvInit.textContent = initial;
      pfAvInit.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'none';
    }

    $('pf-un').textContent = '@' + (profile.username || S.user.username);
    $('pf-fname').value = profile.first_name || '';
    $('pf-lname').value = profile.last_name || '';
    $('pf-email').value = profile.email || '';
    $('pf-since').textContent = profile.created_at ? fmtFullTime(profile.created_at) : '-';
    openM('pf-modal');
  }).catch(function () {
    // Fallback to local user data
    $('pf-av').src = S.user.profile_picture || seed(S.user.username);
    $('pf-un').textContent = '@' + S.user.username;
    $('pf-fname').value = S.user.first_name || '';
    $('pf-lname').value = S.user.last_name || '';
    $('pf-email').value = S.user.email || '';
    $('pf-since').textContent = '-';
    openM('pf-modal');
  });
}

// Save profile
function saveProfile() {
  var firstName = $('pf-fname').value.trim();
  var lastName = $('pf-lname').value.trim();
  var email = $('pf-email').value.trim();

  api('/profile/', {
    method: 'POST',
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email: email
    })
  }).then(function (res) {
    S.user.first_name = res.first_name;
    S.user.last_name = res.last_name;
    S.user.email = res.email;

    // Sidebar username turant update karo
    var fullName = ((res.first_name || '') + ' ' + (res.last_name || '')).trim() || S.user.username;
    var sbEl = document.getElementById('sb-username');
    if (sbEl) sbEl.textContent = fullName;

    toast('Profile updated!', 's');
    closeM('pf-modal');
  }).catch(function () {
    toast('Failed to update profile', 'e');
  });
}

// Upload profile picture
function uploadProfilePicture(input) {
  if (!input.files || !input.files[0]) return;

  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    toast('File too large (max 5MB)', 'e');
    return;
  }

  var formData = new FormData();
  formData.append('picture', file);

  // Show loading state
  $('pf-av').style.opacity = '0.5';

  fetch(API_URL + '/profile_picture/', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + S.token },
    body: formData
  }).then(function (r) {
    if (!r.ok) throw new Error('Upload failed');
    return r.json();
  }).then(function (res) {
    $('pf-av').src = res.profile_picture + '?t=' + Date.now();
    $('pf-av').style.opacity = '1';
    S.user.profile_picture = res.profile_picture;

    var myAv = $('my-av');
    var myAvInit = $('my-av-init');
    var initial = (S.user.first_name || S.user.username || 'U')[0].toUpperCase();

    if (myAv && myAvInit) {
      myAv.src = res.profile_picture + '?t=' + Date.now();
      myAv.style.cssText = 'display:block;width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.4);';
      myAvInit.style.display = 'none';

      // Agar image fail ho
      myAv.onerror = function () {
        myAv.style.display = 'none';
        myAvInit.textContent = initial;
        myAvInit.style.display = 'flex';
      };
    }

    toast('Profile picture updated!', 's');
  }).catch(function () {
    $('pf-av').style.opacity = '1';
    toast('Failed to upload picture', 'e');
  });

  input.value = ''; // Reset input
}

// Remove profile picture
function removeProfilePicture() {
  if (!confirm('Are you sure you want to remove your profile photo?')) return;

  api('/remove_picture/', {
    method: 'POST'
  }).then(function (res) {
    console.log('Remove picture response:', res); // Debug
    if (res && res.success) {
      S.user.profile_picture = null;
      var initial = (S.user.first_name || S.user.username || 'U')[0].toUpperCase();

      // Profile modal update
      var pfAv = $('pf-av');
      var pfAvInit = $('pf-av-init');
      var removeBtn = $('remove-photo-btn');

      pfAv.style.display = 'none';
      pfAv.src = '';
      pfAvInit.textContent = initial;
      pfAvInit.style.display = 'flex';
      if (removeBtn) removeBtn.style.display = 'none';

      // Sidebar update
      var myAv = $('my-av');
      var myAvInit = $('my-av-init');
      if (myAv) myAv.style.display = 'none';
      if (myAvInit) {
        myAvInit.textContent = initial;
        myAvInit.style.display = 'flex';
      }

      toast('Profile photo removed!', 's');
    } else {
      toast('Failed to remove photo. Please try again.', 'e');
    }
  }).catch(function () {
    toast('Failed to remove photo', 'e');
  });
}

function goBack() {
  document.getElementById('sidebar').style.display = '';
  document.getElementById('chat-panel').style.removeProperty('display');
  document.getElementById('chat-panel').classList.remove('active');
  document.getElementById('back-btn').style.display = 'none';
  S.activeUser = null;
  S.activeGroup = null;
}
// Modal management
function openM(id) { $(id).classList.add('open'); }
function closeM(id) { $(id).classList.remove('open'); }

// Close modal on backdrop click
document.querySelectorAll('.modal-bg').forEach(function (bg) {
  bg.addEventListener('click', function (e) {
    if (e.target === bg) bg.classList.remove('open');
  });
});

// ═══════════════════════════════════════════════════════════════
// CALL FUNCTIONALITY
// ═══════════════════════════════════════════════════════════════

// ICE candidates queue
var pendingIceCandidates = [];
var CallState = {
  isInCall: false,
  callType: null,
  callId: null,
  remoteUserId: null,
  remoteUserName: '',
  pc: null,  // RTCPeerConnection
  localStream: null,
  remoteStream: null,
  timerInterval: null,
  callStartTime: null,
  isMuted: false,
  isCamOff: false,
  isSpeakerOff: false
};

var rtcConfig = {
  iceServers: [], // loadTURNServers fill karega
  iceTransportPolicy: 'all'
};

// TURN credentials dynamically load
// TURN ready flag
var turnReady = false;

// TURN credentials load - app shuru hote hi
rtcConfig.iceServers = [
  { urls: "stun:187.77.158.226:3478" },
  {
    urls: "turn:187.77.158.226:3478",
    username: "skyuser",
    credential: "skypass123"
  },
  {
    urls: "turn:187.77.158.226:3478?transport=tcp",
    username: "skyuser",
    credential: "skypass123"
  }
];
// Check media permissions before call
async function checkMediaPermissions(type) {
  try {
    // Check if mediaDevices is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { success: false, error: 'Your browser does not support media access. Please use Chrome, Firefox, or Edge.' };
    }

    // Check if we're in a secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      return { success: false, error: 'Camera/microphone access requires HTTPS. Please use https://localhost:8000' };
    }

    // Query permissions (if supported)
    if (navigator.permissions) {
      try {
        var micPerm = await navigator.permissions.query({ name: 'microphone' });
        if (micPerm.state === 'denied') {
          return { success: false, error: 'Microphone access is blocked. Please allow it in browser settings.' };
        }

        if (type === 'video') {
          var camPerm = await navigator.permissions.query({ name: 'camera' });
          if (camPerm.state === 'denied') {
            return { success: false, error: 'Camera access is blocked. Please allow it in browser settings.' };
          }
        }
      } catch (e) {
        // Permissions API not fully supported, continue anyway
        console.log('Permissions query not supported:', e);
      }
    }

    return { success: true };
  } catch (e) {
    console.error('Permission check error:', e);
    return { success: true }; // Continue anyway
  }
}

function startCall(type) {
  console.log('startCall called with type:', type, 'activeUser:', S.activeUser, 'isInCall:', CallState.isInCall);
  if (!S.activeUser || CallState.isInCall) {
    if (!S.activeUser) toast('Select a chat first', 'e');
    return;
  }

    if (!turnReady) {
    toast('Connecting... please wait', 'i');
    loadTURNServers(function () {
      startCall(type); // retry
    });
    return;
  }

  CallState.callType = type;
  CallState.remoteUserId = S.activeUser.id;
  CallState.remoteUserName = dname(S.activeUser);
  console.log('Starting call to:', CallState.remoteUserName, 'ID:', CallState.remoteUserId);

  // Check permissions first
  checkMediaPermissions(type).then(function (result) {
    if (!result.success) {
      toast(result.error, 'e');
      return;
    }

    // Show outgoing call UI
    $('outgoing-av').src = S.activeUser.profile_picture || seed(S.activeUser.username);
    $('outgoing-name').textContent = CallState.remoteUserName;
    $('outgoing-type').innerHTML = type === 'video' ? '<i class="fa-solid fa-video"></i> Video Call' : '<i class="fa-solid fa-phone"></i> Voice Call';

    // Show/hide local video preview for video calls
    var localWrap = $('outgoing-local-wrap');
    if (localWrap) {
      if (type === 'video') {
        localWrap.classList.add('active');
      } else {
        localWrap.classList.remove('active');
      }
    }

    showCallOverlay('outgoing-call');

    // Play ringback tone
    var ringback = $('ringback');
    if (ringback) ringback.play().catch(function () { });

    // Get user media with better constraints
    var constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    };
    if (type === 'video') {
      constraints.video = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      };
    }

    navigator.mediaDevices.getUserMedia(constraints)
      .then(function (stream) {
        CallState.localStream = stream;
        if (type === 'video') {
          $('local-video').srcObject = stream;
          // Also set to outgoing call preview
          var outgoingVideo = $('outgoing-local-video');
          if (outgoingVideo) outgoingVideo.srcObject = stream;
        }
        initWebRTC(true);
      })
      .catch(function (err) {
        console.error('Media error:', err);
        var errorMsg = getMediaErrorMessage(err, type);
        toast(errorMsg, 'e');
        cancelCall();
      });
  });
}

// Get user-friendly error message for media errors
function getMediaErrorMessage(err, type) {
  var deviceName = type === 'video' ? 'camera/microphone' : 'microphone';

  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Permission denied. Please allow ' + deviceName + ' access in your browser.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No ' + deviceName + ' found. Please connect a device.';
    case 'NotReadableError':
    case 'TrackStartError':
      return deviceName.charAt(0).toUpperCase() + deviceName.slice(1) + ' is in use by another app. Please close it and try again.';
    case 'OverconstrainedError':
      return 'Could not find a suitable ' + deviceName + '. Try again.';
    case 'SecurityError':
      return 'Security error. Make sure you are using HTTPS.';
    case 'AbortError':
      return deviceName.charAt(0).toUpperCase() + deviceName.slice(1) + ' access was aborted.';
    default:
      return 'Could not access ' + deviceName + '. Error: ' + (err.message || err.name);
  }
}

function initWebRTC(isInitiator, callback) {
  doInitWebRTC(isInitiator, callback);
}

function doInitWebRTC(isInitiator, callback) {
  CallState.pc = new RTCPeerConnection(rtcConfig);

  CallState.pc.oniceconnectionstatechange = function () {
    console.log('ICE State:', CallState.pc.iceConnectionState);
    if (CallState.pc.iceConnectionState === 'failed') {
      console.log('ICE Failed! Restarting...');
      CallState.pc.restartIce();
    }
  };

  CallState.pc.onconnectionstatechange = function () {
    console.log('Connection State:', CallState.pc.connectionState);
  };

  if (CallState.localStream) {
    CallState.localStream.getTracks().forEach(function (track) {
      console.log('Adding local track:', track.kind);
      CallState.pc.addTrack(track, CallState.localStream);
    });
  }

  CallState.pc.onicecandidate = function (e) {
    if (e.candidate) {
      console.log('Sending ICE candidate');
      var ws = S.globalWs || S.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'call_ice',
          target_user_id: CallState.remoteUserId,
          candidate: e.candidate
        }));
      }
    }
  };

  CallState.pc.ontrack = function (e) {
    console.log('Remote track received:', e.track.kind);
    CallState.remoteStream = e.streams[0];

    if (e.track.kind === 'audio') {
      var remoteAudio = $('remote-audio');
      if (remoteAudio) {
        remoteAudio.srcObject = e.streams[0];
        remoteAudio.muted = false;
        remoteAudio.volume = 1.0;
        var playPromise = remoteAudio.play();
        if (playPromise !== undefined) {
          playPromise.catch(function (err) {
            console.warn('Autoplay blocked, retrying...', err);
            document.addEventListener('click', function retry() {
              remoteAudio.play().catch(console.error);
              document.removeEventListener('click', retry);
            }, { once: true });
          });
        }
      }
    }

    if (e.track.kind === 'video') {
      var remoteVideo = $('remote-video');
      if (remoteVideo) {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.play().catch(function (err) { console.log('Video play error:', err); });
      }
    }
  };;

  if (isInitiator) {

    CallState.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: CallState.callType === 'video'
    })
      .then(function (offer) {
        return CallState.pc.setLocalDescription(offer);
      })
      .then(function () {
        var ws = S.globalWs || S.ws;
        console.log('Sending call_initiate to user:', CallState.remoteUserId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'call_initiate',
            call_type: CallState.callType,
            receiver_id: CallState.remoteUserId,
            sdp: CallState.pc.localDescription
          }));
          console.log('Call initiate sent!');
        } else {
          console.error('No WS connection!');
          toast('Connection error. Please refresh.', 'e');
          cancelCall();
        }
      })
      .catch(function (err) {
        console.error('Offer error:', err);
        cancelCall();
      });
  } else {
    if (callback) callback();
  }
}

function handleIncomingCall(data) {
  if (CallState.isInCall) {
    // Busy - reject
    var ws = S.globalWs || S.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'call_reject',
        call_id: data.call_id,
        caller_id: data.caller_id,
        reason: 'busy'
      }));
    }
    return;
  }

  CallState.callId = data.call_id;
  CallState.callType = data.call_type;
  CallState.remoteUserId = data.caller_id;
  CallState.remoteUserName = data.caller_name || 'Unknown';

  // Show incoming call UI
  $('incoming-av').src = data.caller_profile_picture || seed(data.caller_username || 'user');
  $('incoming-name').textContent = CallState.remoteUserName;
  $('incoming-type').innerHTML = data.call_type === 'video' ? '<i class="fa-solid fa-video"></i> Video Call' : '<i class="fa-solid fa-phone"></i> Voice Call';
  showCallOverlay('incoming-call');

  // Play ringtone
  var ringtone = $('ringtone');
  if (ringtone) ringtone.play().catch(function () { });

  // Store SDP for later
  CallState.remoteSdp = data.sdp;
}

function acceptCall() {
  hideAllCallOverlays();
  stopAllRingtones();

  CallState.isInCall = true;

  var constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true
    }
  };
  if (CallState.callType === 'video') {
    constraints.video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user'
    };
  }

  navigator.mediaDevices.getUserMedia(constraints)
    .then(function (stream) {
      CallState.localStream = stream;
      $('local-video').srcObject = stream;

      // SIRF EK BAAR initWebRTC call karein
      initWebRTC(false, function () {
        if (CallState.remoteSdp) {
          CallState.pc.setRemoteDescription(new RTCSessionDescription(CallState.remoteSdp))
            .then(function () {
              return CallState.pc.createAnswer();
            })
            .then(function (answer) {
              return CallState.pc.setLocalDescription(answer);
            })
            .then(function () {
              var ws = S.globalWs || S.ws;
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'call_accept',
                  call_id: CallState.callId,
                  caller_id: CallState.remoteUserId,
                  sdp: CallState.pc.localDescription
                }));
              }
              flushPendingIceCandidates();
              showOngoingCall();
            });
        }
      });
    })
    .catch(function (err) {
      console.error('Media error:', err);
      var errorMsg = getMediaErrorMessage(err, CallState.callType);
      toast(errorMsg, 'e');
      rejectCall();
    });
}
function rejectCall() {
  stopAllRingtones();

  var ws = S.globalWs || S.ws;
  if (CallState.callId && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'call_reject',
      call_id: CallState.callId,
      caller_id: CallState.remoteUserId,
      reason: 'rejected'
    }));
  }

  hideAllCallOverlays();
  resetCallState();
  playEndSound();
}

function cancelCall() {
  stopAllRingtones();

  var ws = S.globalWs || S.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'call_cancel',
      receiver_id: CallState.remoteUserId
    }));
  }

  hideAllCallOverlays();
  cleanupCall();
  playEndSound();
}

function endCall() {
  stopAllRingtones();

  var ws = S.globalWs || S.ws;
  if (ws && ws.readyState === WebSocket.OPEN && CallState.isInCall) {
    ws.send(JSON.stringify({
      type: 'call_end',
      call_id: CallState.callId,
      target_user_id: CallState.remoteUserId
    }));
  }

  hideAllCallOverlays();
  cleanupCall();
  playEndSound();
  toast('Call ended', 's');
}

function handleCallAccepted(data) {
  stopAllRingtones();
  CallState.isInCall = true;
  CallState.callId = data.call_id;

  if (data.sdp && CallState.pc) {
    CallState.pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(function () {
        flushPendingIceCandidates(); // ← ADD KIYA
      })
      .catch(function (err) { console.error('SDP error:', err); });
  }

  showOngoingCall();
}
function handleCallRejected(data) {
  stopAllRingtones();
  hideAllCallOverlays();
  cleanupCall();
  playEndSound();

  var reason = data.reason || 'rejected';
  if (reason === 'busy') {
    toast('User is busy', 'e');
  } else {
    toast('Call declined', 'e');
  }
}

function handleCallEnded(data) {
  stopAllRingtones();
  hideAllCallOverlays();
  cleanupCall();
  playEndSound();
  toast('Call ended', 's');
}

function handleCallCancelled(data) {
  stopAllRingtones();
  hideAllCallOverlays();
  cleanupCall();
  playEndSound();
  toast('Call cancelled', 's');
}

function handleIceCandidate(data) {
  if (!data.candidate) return;

  if (CallState.pc && CallState.pc.remoteDescription && CallState.pc.remoteDescription.type) {
    // Remote description set hai - seedha add karo
    CallState.pc.addIceCandidate(new RTCIceCandidate(data.candidate))
      .catch(function (err) { console.error('ICE error:', err); });
  } else {
    // Remote description abhi set nahi - queue mein rakh do
    console.log('Queuing ICE candidate');
    pendingIceCandidates.push(data.candidate);
  }
}

function flushPendingIceCandidates() {
  console.log('Flushing', pendingIceCandidates.length, 'pending ICE candidates');
  pendingIceCandidates.forEach(function (candidate) {
    CallState.pc.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(function (err) { console.error('ICE flush error:', err); });
  });
  pendingIceCandidates = [];
}

function showOngoingCall() {
  hideAllCallOverlays();

  var ongoingAv = $('ongoing-av');
  if (ongoingAv) {
    ongoingAv.src = (S.activeUser && S.activeUser.profile_picture) ? S.activeUser.profile_picture : seed(S.activeUser ? S.activeUser.username : 'user');
    ongoingAv.style.display = CallState.callType === 'video' ? 'none' : 'block';
  }

  var ongoingName = $('ongoing-name');
  if (ongoingName) ongoingName.textContent = CallState.remoteUserName;

  showCallOverlay('ongoing-call');

  CallState.callStartTime = Date.now();
  CallState.timerInterval = setInterval(updateCallTimer, 1000);
  updateCallTimer();

  if (CallState.callType === 'video') {
    if ($('local-video')) $('local-video').style.display = 'block';
    if ($('remote-video')) $('remote-video').style.display = 'block';
  } else {
    if ($('local-video')) $('local-video').style.display = 'none';
    if ($('remote-video')) $('remote-video').style.display = 'none';
  }
}

function updateCallTimer() {
  if (!CallState.callStartTime) return;
  var elapsed = Math.floor((Date.now() - CallState.callStartTime) / 1000);
  var mins = Math.floor(elapsed / 60);
  var secs = elapsed % 60;
  $('call-timer').textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function toggleMic() {
  if (!CallState.localStream) return;
  CallState.isMuted = !CallState.isMuted;
  CallState.localStream.getAudioTracks().forEach(function (t) { t.enabled = !CallState.isMuted; });
  var btn = document.querySelector('.ctrl-btn[onclick*="toggleMic"]');
  if (btn) {
    btn.classList.toggle('muted', CallState.isMuted);
    btn.innerHTML = CallState.isMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
  }
}

function toggleCam() {
  if (!CallState.localStream) return;
  CallState.isCamOff = !CallState.isCamOff;
  CallState.localStream.getVideoTracks().forEach(function (t) { t.enabled = !CallState.isCamOff; });
  var btn = document.querySelector('.ctrl-btn[onclick*="toggleCam"]');
  if (btn) {
    btn.classList.toggle('muted', CallState.isCamOff);
    btn.innerHTML = CallState.isCamOff ? '<i class="fa-solid fa-video-slash"></i>' : '<i class="fa-solid fa-video"></i>';
  }
}

function toggleSpeaker() {
  CallState.isSpeakerOff = !CallState.isSpeakerOff;
  var remoteAudio = $('remote-audio');
  if (remoteAudio) remoteAudio.muted = CallState.isSpeakerOff;
  var remoteVideo = $('remote-video');
  if (remoteVideo) remoteVideo.muted = CallState.isSpeakerOff;
  var btn = document.querySelector('.ctrl-btn[onclick*="toggleSpeaker"]');
  if (btn) {
    btn.classList.toggle('muted', CallState.isSpeakerOff);
    btn.innerHTML = CallState.isSpeakerOff ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
  }
}

function showCallOverlay(id) {
  $(id).classList.add('active');
}

function hideAllCallOverlays() {
  ['incoming-call', 'outgoing-call', 'ongoing-call'].forEach(function (id) {
    var el = $(id);
    if (el) el.classList.remove('active');
  });
  // Hide outgoing local video preview
  var localWrap = $('outgoing-local-wrap');
  if (localWrap) localWrap.classList.remove('active');
  // Clear outgoing local video
  var outgoingVideo = $('outgoing-local-video');
  if (outgoingVideo) outgoingVideo.srcObject = null;
}

function stopAllRingtones() {
  ['ringtone', 'ringback'].forEach(function (id) {
    var el = $(id);
    if (el) { el.pause(); el.currentTime = 0; }
  });
}

function playEndSound() {
  var snd = $('callend');
  if (snd) snd.play().catch(function () { });
}

function cleanupCall() {
  if (CallState.pc) {
    CallState.pc.close();
  }
  if (CallState.localStream) {
    CallState.localStream.getTracks().forEach(function (t) { t.stop(); });
  }
  if (CallState.timerInterval) {
    clearInterval(CallState.timerInterval);
  }
  resetCallState();
}

function resetCallState() {
  CallState.isInCall = false;
  CallState.callType = null;
  CallState.callId = null;
  CallState.remoteUserId = null;
  CallState.remoteUserName = '';
  CallState.pc = null;
  CallState.localStream = null;
  CallState.remoteStream = null;
  CallState.timerInterval = null;
  CallState.callStartTime = null;
  CallState.remoteSdp = null;
  CallState.isMuted = false;
  CallState.isCamOff = false;
  CallState.isSpeakerOff = false;
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
function showNotification(title, body, avatar, onClick, isCall) {
  // Show popup notification with sound
  showPopupNotification(title, body, avatar, onClick, isCall);

  // Also try browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    var notif = new Notification(title, {
      body: body,
      icon: avatar || '/static/images/default-av.png',
      tag: 'chat-notification',
      renotify: true,
      silent: true // We play our own sound
    });
    if (onClick) notif.onclick = onClick;
    setTimeout(function () { notif.close(); }, 5000);
  }
}



// Message notification sound
var msgSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
msgSound.volume = 0.5;

function showPopupNotification(title, body, avatar, onClick, isCall) {
  // Play notification sound (not for calls - they have ringtone)
  if (!isCall) {
    msgSound.currentTime = 0;
    msgSound.play().catch(function () { });
  }

  var container = $('notif-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notif-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column-reverse;gap:10px;max-width:350px;';
    document.body.appendChild(container);
  }

  var notif = document.createElement('div');
  notif.className = 'popup-notif';
  notif.style.cssText = 'background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:14px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;animation:slideInRight 0.4s ease;box-shadow:0 8px 32px rgba(0,0,0,0.4);backdrop-filter:blur(10px);';

  var iconHtml = isCall ?
    '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#34c759,#28a745);display:flex;align-items:center;justify-content:center;animation:pulse 1s infinite;"><i class="fa-solid fa-phone" style="color:#fff;font-size:20px;"></i></div>' :
    '<img src="' + (avatar || seed('user')) + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--blue);">';

  notif.innerHTML =
    iconHtml +
    '<div style="flex:1;min-width:0;">' +
    '<div style="font-weight:600;color:#fff;font-size:15px;margin-bottom:4px;">' + esc(title) + '</div>' +
    '<div style="color:rgba(255,255,255,0.7);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(body) + '</div>' +
    '</div>' +
    '<button style="background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.7);cursor:pointer;font-size:14px;padding:8px;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;" onclick="event.stopPropagation();this.parentElement.remove();"><i class="fa-solid fa-xmark"></i></button>';

  if (onClick) {
    notif.onclick = function () {
      onClick();
      notif.remove();
    };
  }

  container.appendChild(notif);

  // Auto remove after 5 seconds
  setTimeout(function () {
    if (notif.parentElement) {
      notif.style.animation = 'slideOutRight 0.4s ease';
      setTimeout(function () { notif.remove(); }, 400);
    }
  }, 5000);
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Add notification styles
var notifStyle = document.createElement('style');
notifStyle.textContent = '@keyframes slideInRight { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } } @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }';
document.head.appendChild(notifStyle);

// Initialize on load
requestNotificationPermission();
init();
