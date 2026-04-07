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
  const av = msg.profile_picture || seed(msg.username || 'User');
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
  // Returns a data URI SVG of a colored circle with initials
  var name = (n || 'U').trim() || 'U';
  var parts = name.split(/[\s@]+/).filter(function(p) { return p.length > 0; });
  var first = parts[0] || 'U';
  var second = parts.length > 1 ? parts[1] : '';
  var initials = (first[0] + (second ? second[0] : '')).toUpperCase();
  var bg = '#1a73e8';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="' + bg + '"/><text x="50" y="50" dy=".35em" text-anchor="middle" fill="white" font-family="sans-serif" font-size="40" font-weight="700">' + initials + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Get avatar URL - use profile_picture if available, otherwise initials
function getAvatar(user) {
  if (!user) return seed('U');
  if (user.profile_picture) return user.profile_picture;
  var name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.username || 'U';
  return seed(name);
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

// Token refresh — prevents infinite reload loop when JWT expires
var _refreshPromise = null;
function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  var rt = localStorage.getItem('refresh_token');
  if (!rt) { localStorage.clear(); go('/login/'); return Promise.reject('no refresh token'); }
  _refreshPromise = fetch('/api/auth/token/refresh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: rt })
  }).then(function (r) {
    _refreshPromise = null;
    if (!r.ok) { localStorage.clear(); go('/login/'); throw new Error('refresh failed'); }
    return r.json();
  }).then(function (data) {
    S.token = data.access;
    localStorage.setItem('access_token', data.access);
    return data.access;
  }).catch(function (e) { _refreshPromise = null; throw e; });
  return _refreshPromise;
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
      if (r.status === 401) {
        // Try refresh then retry once
        return refreshAccessToken().then(function (newToken) {
          var h2 = Object.assign({}, headers, { 'Authorization': 'Bearer ' + newToken });
          return fetch(API_URL + path, Object.assign({}, opts, { headers: h2 }));
        }).then(function (r2) {
          if (r2.status === 401) { localStorage.clear(); go('/login/'); return null; }
          if (!r2.ok) throw new Error('API error');
          return r2.json();
        });
      }
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
  // Use api() so token refresh is handled automatically
  api('/me/')
    .then(function (user) {
      if (!user) return;
      S.user = user;

      // Header mein user ka naam
      var fullName = ((S.user.first_name || '') + ' ' + (S.user.last_name || '')).trim() || S.user.username;
      $('sb-username').textContent = fullName;

      // Avatar ya initial letter
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
          myAv.src = seed(fullName);
          myAv.style.display = 'block';
          myAvInit.style.display = 'none';
        };
      } else {
        // No picture - show initials SVG
        myAv.src = seed(fullName);
        myAv.style.cssText = 'display:block;width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.4);';
        myAvInit.style.display = 'none';
      }

      buildEmoji();
      loadConvs();
      loadGroups();
      connectGlobalWS();
      loadTURNServers(); 
      initPasteHandler();

      // Handle open_group URL parameter (from push notification click)
      var urlParams = new URLSearchParams(window.location.search);
      var openGroupId = urlParams.get('open_group');
      if (openGroupId) {
        // Clean URL
        history.replaceState(null, '', '/chat/');
        setTimeout(function () { openGroup(parseInt(openGroupId)); }, 800);
      }
    }).catch(function (err) {
      // Do not force-login on generic runtime errors; prevents redirect loops.
      console.error('Init failed:', err);
      toast('Failed to initialize chat. Please refresh once.', 'e');
    });
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
          data.caller_profile_picture || seed(data.caller_name || data.caller_username || 'User'),
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
      // Group call events
      else if (data.type === 'group_call_notify') {
        handleGroupCallNotify(data);
      } else if (data.type === 'group_call_started') {
        handleGroupCallStarted(data);
      } else if (data.type === 'group_call_joined') {
        handleGroupCallJoined(data);
      } else if (data.type === 'group_call_user_joined') {
        handleGroupCallUserJoined(data);
      } else if (data.type === 'group_call_offer') {
        handleGroupCallOffer(data);
      } else if (data.type === 'group_call_answer') {
        handleGroupCallAnswer(data);
      } else if (data.type === 'group_call_ice') {
        handleGroupCallIce(data);
      } else if (data.type === 'group_call_user_left') {
        handleGroupCallUserLeft(data);
      } else if (data.type === 'group_call_ended') {
        handleGroupCallEnded(data);
      }
      // Live events (online status, new message notifications)
      else if (data.type === 'online_status') {
        handleOnlineStatus(data);
      } else if (data.type === 'new_message_notify') {
        handleNewMessageNotify(data);
      }
    } catch (err) { console.warn('Global WS error:', err); }
  };

  ws.onclose = function (e) {
    console.log('Global WS Disconnected, reconnecting...');
    setTimeout(connectGlobalWS, 3000);
  };

  ws.onerror = function () { ws.close(); };
}

// Load conversations
function loadConvs() {
  api('/conversations/').then(function (convs) {
    S.convs = convs || [];
    if (S.currentTab === 'chats' || S.currentTab === 'unread') {
      renderConvList(S.convs);
    }
  }).catch(function (e) {
    console.error('Failed to load chats:', e);
    if (S.currentTab === 'chats' || S.currentTab === 'unread') {
      $('conv-list').innerHTML = '<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">No chats yet.</div>';
    }
  });
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
    if (S.currentTab === 'groups') {
      $('conv-list').innerHTML = '<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">No groups yet.</div>';
    }
  });
}

// Render conversation list
function renderConvList(items) {
  var el = $('conv-list');
  el.innerHTML = '';

  // Filter for unread tab
  var displayItems = items;
  if (S.currentTab === 'unread') {
    displayItems = items.filter(function (item) { return item.unread_count > 0; });
  }

  if (!displayItems.length) {
    el.innerHTML = S.currentTab === 'unread'
      ? '<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">No unread messages</div>'
      : '<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">No chats yet. Click <i class="fa-solid fa-comment-medical"></i> to start one!</div>';
    return;
  }

  var frag = document.createDocumentFragment();
  displayItems.forEach(function (item) {
    var isGroupItem = item.type === 'group';
    var last = item.last_message || 'No messages yet';
    var time = item.last_message_time ? fmtTime(item.last_message_time) : '';
    var unread = item.unread_count || 0;
    var badgeHtml = unread > 0 ? '<div class="unread-badge">' + (unread > 99 ? '99+' : unread) + '</div>' : '';
    var timeClass = unread > 0 ? 'conv-time unread' : 'conv-time';

    var node = document.createElement('div');
    node.className = 'conv-item';

    if (isGroupItem) {
      var g = item.group;
      var gid = g.id;
      var act = S.activeGroup && S.activeGroup.id === gid;
      node.classList.toggle('active', act);
      node.dataset.gid = gid;
      node.innerHTML = '<div class="av-wrap">' +
        '<img class="av-img av-52" src="' + esc(g.group_picture || seed(g.name)) + '">' +
      '</div>' +
      '<div class="conv-body">' +
        '<div class="conv-name">' + esc(g.name) + '</div>' +
        '<div class="conv-prev">' + esc(last) + '</div>' +
      '</div>' +
      '<div class="conv-meta">' +
        '<div class="' + timeClass + '">' + time + '</div>' +
        badgeHtml +
      '</div>';
      node.addEventListener('click', function () { openGroup(parseInt(this.dataset.gid)); });
    } else {
      var u = item.user;
      var uid = u && u.id;
      var name = dname(u);
      var online = !!(u && u.is_online);
      var act = S.activeUser && S.activeUser.id === uid;
      node.classList.toggle('active', act);
      node.dataset.uid = uid;
      node.innerHTML = '<div class="av-wrap">' +
        '<img class="av-img av-52" src="' + esc(getAvatar(u)) + '">' +
        '<div class="sdot ' + (online ? 'on' : 'off') + '"></div>' +
      '</div>' +
      '<div class="conv-body">' +
        '<div class="conv-name">' + esc(name) + '</div>' +
        '<div class="conv-prev">' + esc(last) + '</div>' +
      '</div>' +
      '<div class="conv-meta">' +
        '<div class="' + timeClass + '">' + time + '</div>' +
        badgeHtml +
      '</div>';
      node.addEventListener('click', function () { openChat(parseInt(this.dataset.uid)); });
    }
    frag.appendChild(node);
  });

  el.appendChild(frag);
}


// Render group list (Groups tab only - no DMs)
function renderGroupList(groups) {
  var el = $('conv-list');
  el.innerHTML = '';

  if (!groups.length) {
    el.innerHTML = '<div style="padding:28px;text-align:center;color:var(--sub);font-size:13px;">No groups yet. Click <i class="fa-solid fa-comment-medical"></i> to create one!</div>';
    return;
  }

  var frag = document.createDocumentFragment();
  groups.forEach(function (g) {
    var gid = String(g.id);
    var act = S.activeGroup && S.activeGroup.id === g.id;
    var memberCount = g.members ? g.members.length : 0;
    var time = g.last_message_time ? fmtTime(g.last_message_time) : '';
    var last = g.last_message || memberCount + ' members';

    var node = document.createElement('div');
    node.className = 'conv-item' + (act ? ' active' : '');
    node.dataset.gid = gid;
    node.innerHTML = '<div class="av-wrap">' +
      '<img class="av-img av-52" src="' + esc(g.group_picture || seed(g.name)) + '">' +
    '</div>' +
    '<div class="conv-body">' +
      '<div class="conv-name">' + esc(g.name) + '</div>' +
      '<div class="conv-prev">' + esc(last) + '</div>' +
    '</div>' +
    '<div class="conv-meta">' +
      '<div class="conv-time' + (g.unread_count > 0 ? ' unread' : '') + '">' + time + '</div>' +
      (g.unread_count > 0 ? '<span class="unread-badge">' + g.unread_count + '</span>' : '') +
    '</div>';
    node.addEventListener('click', function () { openGroup(parseInt(this.dataset.gid)); });
    frag.appendChild(node);
  });

  el.appendChild(frag);
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

  // Clear unread count for this conversation
  for (var k = 0; k < S.convs.length; k++) {
    if (S.convs[k].user && S.convs[k].user.id === userId) {
      S.convs[k].unread_count = 0;
      break;
    }
  }
  // Re-render sidebar to update badge
  if (S.currentTab === 'chats' || S.currentTab === 'unread') {
    renderConvList(S.convs);
  }

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
  // Also check convs list (groups appear in Chats tab)
  if (!group) {
    for (var j = 0; j < S.convs.length; j++) {
      if (S.convs[j].type === 'group' && S.convs[j].group && S.convs[j].group.id === groupId) {
        group = S.convs[j].group;
        break;
      }
    }
  }
  if (!group) { toast('Group not found', 'e'); return; }

  S.activeGroup = group;
  S.activeUser = null;
  S.isGroup = true;

  // Clear unread count in convs
  for (var k = 0; k < S.convs.length; k++) {
    if (S.convs[k].type === 'group' && S.convs[k].group && S.convs[k].group.id === groupId) {
      S.convs[k].unread_count = 0;
      break;
    }
  }
  // Clear unread count in groups list
  for (var m = 0; m < S.groups.length; m++) {
    if (S.groups[m].id === groupId) {
      S.groups[m].unread_count = 0;
      break;
    }
  }
  if (S.currentTab === 'chats' || S.currentTab === 'unread') {
    renderConvList(S.convs);
  }
  if (S.currentTab === 'groups') {
    renderGroupList(S.groups);
  }

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
    history.pushState({ view: 'chat' }, '');
  } else {
    document.getElementById('back-btn').style.display = 'none';
  }
  var name = dname(user);
  $('tb-name').textContent = name;
  // Remove old initials div if exists
  var oldInit = document.getElementById('tb-av-init');
  if (oldInit) oldInit.remove();
  $('tb-av').src = getAvatar(user);
  $('tb-av').style.display = 'block';
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

  // Make topbar clickable for contact info
  var tbInfo = document.querySelector('.tb-info');
  if (tbInfo) {
    tbInfo.style.cursor = 'pointer';
    tbInfo.onclick = function () { openContactInfo(user); };
  }
  $('tb-dot').style.display = '';

  closeInfoPanel();
  $('msg-area').innerHTML = '';
  updateSendBtn();
  // Hide group call banner in DM view
  var gcBanner = $('gc-join-banner');
  if (gcBanner) gcBanner.style.display = 'none';
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
    history.pushState({ view: 'chat' }, '');
  }
  $('tb-name').textContent = group.name;
  $('tb-av').src = group.group_picture || seed(group.name);
  $('tb-av').style.display = 'block';
  $('tb-av').style.display = 'block';
  // Remove initials div if exists
  var oldInit = document.getElementById('tb-av-init');
  if (oldInit) oldInit.remove();
  $('tb-dot').style.display = 'none';
  var memberCount = group.members ? group.members.length : 0;
  $('tb-sub').textContent = memberCount + ' members';
  $('tb-sub').className = 'tb-sub';
  
  // Make topbar clickable for group info
  var tbInfo = document.querySelector('.tb-info');
  if (tbInfo) {
    tbInfo.style.cursor = 'pointer';
    tbInfo.onclick = function () { openGroupInfo(group.id); };
  }
  
  closeInfoPanel();
  $('msg-area').innerHTML = '';
  updateSendBtn();
  updateGroupCallBanner();
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

  // Only show edit for own messages within 3 hours
  var canEdit = false;
  if (isOut && timestamp) {
    var msgTime = new Date(timestamp).getTime();
    var now = Date.now();
    canEdit = (now - msgTime) < 3 * 60 * 60 * 1000; // 3 hours
  }

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
      ${canEdit ? `<div class="msg-drop-item" onclick="editMsg('${msgId}','${esc(msgText)}')">
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
  
  // Reset
  var readByContainer = $('mi-read-by');
  var deliveredContainer = $('mi-delivered-to');
  var simpleInfo = $('mi-simple-info');
  
  if (S.isGroup && S.activeGroup) {
    // Group message - show read-by list
    if (simpleInfo) simpleInfo.style.display = 'none';
    if (readByContainer) { readByContainer.style.display = 'block'; readByContainer.innerHTML = '<div style="padding:12px;text-align:center;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin"></i></div>'; }
    if (deliveredContainer) { deliveredContainer.style.display = 'block'; deliveredContainer.innerHTML = ''; }
    
    openM('mi-modal');
    
    api('/groups/messages/' + msgId + '/info/')
      .then(function (data) {
        if (!data) return;
        
        $('mi-sent').textContent = fmtFullTime(data.sent_at);
        
        // Read by list
        var readHtml = '<div class="mi-section-title"><span class="msg-ticks read"><i class="fa-solid fa-check"></i><i class="fa-solid fa-check"></i></span> Read by</div>';
        if (data.read_by && data.read_by.length) {
          data.read_by.forEach(function (u) {
            var name = (u.first_name ? (u.first_name + ' ' + (u.last_name || '')).trim() : u.username);
            var av = u.profile_picture || seed(name);
            var time = u.read_at ? fmtFullTime(u.read_at) : '';
            readHtml += '<div class="mi-user-row"><img class="mi-user-av" src="' + esc(av) + '"><div class="mi-user-info"><div class="mi-user-name">' + esc(name) + '</div><div class="mi-user-time">' + time + '</div></div></div>';
          });
        } else {
          readHtml += '<div style="padding:8px 0;color:var(--sub);font-size:13px;">No one yet</div>';
        }
        if (readByContainer) readByContainer.innerHTML = readHtml;
        
        // Delivered to list
        var delHtml = '<div class="mi-section-title"><span class="msg-ticks"><i class="fa-solid fa-check"></i><i class="fa-solid fa-check"></i></span> Delivered to</div>';
        if (data.delivered_to && data.delivered_to.length) {
          data.delivered_to.forEach(function (u) {
            var name = (u.first_name ? (u.first_name + ' ' + (u.last_name || '')).trim() : u.username);
            var av = u.profile_picture || seed(name);
            var time = u.delivered_at ? fmtFullTime(u.delivered_at) : '';
            delHtml += '<div class="mi-user-row"><img class="mi-user-av" src="' + esc(av) + '"><div class="mi-user-info"><div class="mi-user-name">' + esc(name) + '</div><div class="mi-user-time">' + time + '</div></div></div>';
          });
        }
        if (deliveredContainer) deliveredContainer.innerHTML = delHtml;
      });
  } else {
    // Direct message - simple info
    if (simpleInfo) simpleInfo.style.display = 'block';
    if (readByContainer) readByContainer.style.display = 'none';
    if (deliveredContainer) deliveredContainer.style.display = 'none';
    $('mi-delivered').textContent = '-';
    $('mi-seen').textContent = '-';
    
    openM('mi-modal');
    
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
  document.querySelectorAll('.msg-dropdown.show').forEach(function (d) { d.classList.remove('show'); });
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
      updateEditedMsgUI(msgId, newText);
      // Broadcast edit via WebSocket
      if (S.ws && S.ws.readyState === 1) {
        S.ws.send(JSON.stringify({
          type: 'message_edit',
          message_id: msgId,
          new_text: newText,
          group_id: data.group_id || null
        }));
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

function updateEditedMsgUI(msgId, newText) {
  var msgRow = document.getElementById('msg-' + msgId);
  if (!msgRow) return;
  var msgTextEl = msgRow.querySelector('.msg-text');
  if (msgTextEl) msgTextEl.innerHTML = esc(newText);
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
  var isEdited = msg.is_edited || false;
  var replyData = msg.reply_data || null;

  // System message check (e.g. "X left the group", "X removed Y")  
  var isSystem = msg.is_system || false;
  if (!isSystem && S.isGroup && content && (
    content.match(/ left the group$/) ||
    content.match(/ removed /) ||
    content.match(/ added /) ||
    content.match(/ was added$/) ||
    content.match(/ changed the group/)
  )) {
    isSystem = true;
  }

  if (isSystem) {
    var sysDiv = document.createElement('div');
    sysDiv.className = 'system-msg';
    sysDiv.innerHTML = '<span>' + esc(content) + '</span>';
    area.appendChild(sysDiv);
    area.scrollTop = area.scrollHeight;
    return;
  }

  // Group sender name (only for incoming messages in groups)
  var groupSenderHtml = '';
  if (S.isGroup && !me && !consec) {
    var senderColor = strToColor(msg.username || 'user');
    groupSenderHtml = '<div class="group-sender" style="color:' + senderColor + ';">' + esc(senderName) + '</div>';
  }

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
      ${groupSenderHtml}
      ${forwardedLabel}
      ${replyQuote}
      ${msgContent}
      <div class="msg-footer">
        ${isEdited ? '<span class="msg-edited">edited</span>' : ''}<span class="msg-time">${fmtTime(msg.timestamp)}</span>${tick}
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
  if (S.isGroup && S.activeGroup) {
    // Group read receipt - batch and send via WS
    if (!S._pendingGroupReads) S._pendingGroupReads = [];
    S._pendingGroupReads.push(msgId);
    
    clearTimeout(S._groupReadTimer);
    S._groupReadTimer = setTimeout(function () {
      var ids = S._pendingGroupReads;
      S._pendingGroupReads = [];
      
      // Send via API
      api('/groups/' + S.activeGroup.id + '/mark_read/', { method: 'POST' })
        .catch(function () {});
      
      // Send via WS for real-time notification
      if (S.ws && S.ws.readyState === WebSocket.OPEN) {
        S.ws.send(JSON.stringify({
          type: 'group_read',
          group_id: S.activeGroup.id,
          message_ids: ids
        }));
      }
    }, 500);
  } else {
    api('/messages/' + msgId + '/read/', { method: 'POST' })
      .then(function (res) {
        if (res && res.is_read) {
          notifyMessageRead(msgId);
        }
      });
  }
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
  if (!txt) return;
  if (!S.ws || S.ws.readyState !== WebSocket.OPEN) {
    toast('Connecting... try again', 'e');
    // Try to reconnect
    if (S.isGroup && S.activeGroup) {
      connectGroupWS(S.activeGroup.id);
    } else if (S.activeUser) {
      connectWS(S.activeUser.id);
    }
    return;
  }

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
  onInputTyping();
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
    // Auto-reconnect after 3 seconds if we still have an active chat
    if (S.activeUser && S.wsRoom) {
      setTimeout(function () {
        if (S.activeUser) connectWS(S.activeUser.id);
      }, 3000);
    }
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
      var avatar = data.profile_picture || seed(data.display_name || data.username || 'User');
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

  else if (type === 'system_message') {
    appendMsg({
      message: data.message,
      is_system: true,
      timestamp: data.timestamp
    }, false);
  }

  else if (type === 'group_read_receipt') {
    // Only show blue tick when ALL members have read
    if (data.message_ids && data.reader_id !== S.user.id) {
      var readCounts = data.read_counts || {};
      var memberCount = data.member_count || 0;
      data.message_ids.forEach(function (mid) {
        var rc = readCounts[String(mid)] || 0;
        if (memberCount > 0 && rc >= memberCount - 1) {
          updateMessageTick(mid, 'read');
        }
      });
    }
  }

  else if (type === 'message_edited') {
    if (data.username !== S.user.username) {
      updateEditedMsgUI(data.message_id, data.new_text);
    }
  }

  else if (type === 'typing') {
    handleTypingIndicator(data);
  }

  else if (type === 'reaction') {
    handleReactionUpdate(data);
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
  ws.onclose = function () {
    console.log('Group WS Disconnected');
    // Auto-reconnect
    if (S.activeGroup && S.wsRoom) {
      setTimeout(function () {
        if (S.activeGroup) connectGroupWS(S.activeGroup.id);
      }, 3000);
    }
  };
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

// ═══════════════════════════════════════════════════════════════
// REAL-TIME: Online Status
// ═══════════════════════════════════════════════════════════════
function handleOnlineStatus(data) {
  var userId = data.user_id;
  var isOnline = data.is_online;
  var lastSeen = data.last_seen;

  // Update allUsers cache
  S.allUsers.forEach(function (u) {
    if (u.id === userId) {
      u.is_online = isOnline;
      u.last_seen = lastSeen;
    }
  });

  // Update topbar if this user's chat is active
  if (S.activeUser && S.activeUser.id === userId) {
    S.activeUser.is_online = isOnline;
    S.activeUser.last_seen = lastSeen;
    var dot = $('tb-dot'), sub = $('tb-sub');
    if (isOnline) {
      dot.className = 'sdot on';
      sub.textContent = 'Online';
      sub.className = 'tb-sub online';
    } else {
      dot.className = 'sdot off';
      sub.textContent = lastSeenStr(lastSeen);
      sub.className = 'tb-sub';
    }
  }

  // Update sidebar dots
  var convItems = document.querySelectorAll('.conv-item');
  convItems.forEach(function (el) {
    var uid = el.getAttribute('data-user-id');
    if (uid && parseInt(uid) === userId) {
      var dot = el.querySelector('.sdot');
      if (dot) dot.className = isOnline ? 'sdot on' : 'sdot off';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// REAL-TIME: New Message Notify (cross-chat sidebar update)
// ═══════════════════════════════════════════════════════════════
function handleNewMessageNotify(data) {
  // Reload sidebar to show new message / reorder
  loadConvos();

  // If we're NOT in the sender's chat, show notification
  var isInSenderChat = S.activeUser && S.activeUser.id === data.sender_id && !S.isGroup;
  var isInSenderGroup = S.activeGroup && S.isGroup && data.group_id && S.activeGroup.id === data.group_id;

  if (!isInSenderChat && !isInSenderGroup) {
    var title = data.group_name ? (data.sender_name + ' in ' + data.group_name) : data.sender_name;
    showNotifPopup({
      username: title,
      message: data.message,
      profile_picture: data.sender_pic || seed(data.sender_name || 'User')
    });
    showNotification(
      title,
      data.message,
      data.sender_pic || seed(data.sender_name || 'User'),
      function () { window.focus(); },
      false
    );
  }
}

// Alias for loadConvs (compatibility)
function loadConvos() {
  loadConvs();
  loadGroups();
}

// ═══════════════════════════════════════════════════════════════
// REAL-TIME: Typing Indicator
// ═══════════════════════════════════════════════════════════════
var typingTimeout = null;
var isTypingSent = false;

function sendTyping(isTyping) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({ type: 'typing', is_typing: isTyping }));
  }
}

function onInputTyping() {
  if (!isTypingSent) {
    isTypingSent = true;
    sendTyping(true);
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(function () {
    isTypingSent = false;
    sendTyping(false);
  }, 2000);
}

function handleTypingIndicator(data) {
  if (!data.is_typing) {
    hideTypingIndicator();
    return;
  }
  var sub = $('tb-sub');
  if (!sub) return;
  sub.setAttribute('data-original', sub.textContent);
  sub.textContent = (data.display_name || data.username) + ' is typing...';
  sub.className = 'tb-sub typing';

  // Auto-clear after 3s (in case stop event is missed)
  clearTimeout(sub._typingTimer);
  sub._typingTimer = setTimeout(hideTypingIndicator, 3000);
}

function hideTypingIndicator() {
  var sub = $('tb-sub');
  if (!sub || !sub.classList.contains('typing')) return;
  // Restore original text
  if (S.activeUser) {
    if (S.activeUser.is_online) {
      sub.textContent = 'Online';
      sub.className = 'tb-sub online';
    } else {
      sub.textContent = lastSeenStr(S.activeUser.last_seen);
      sub.className = 'tb-sub';
    }
  } else {
    var orig = sub.getAttribute('data-original');
    if (orig) sub.textContent = orig;
    sub.className = 'tb-sub';
  }
}

// ═══════════════════════════════════════════════════════════════
// REAL-TIME: Reaction Updates
// ═══════════════════════════════════════════════════════════════
function handleReactionUpdate(data) {
  // Reload reactions for this message
  var msgEl = document.getElementById('msg-' + data.message_id);
  if (!msgEl) return;
  // Refresh reactions via API
  api('/messages/' + data.message_id + '/react/', { method: 'GET' }).then(function (resp) {
    if (resp && resp.reactions) {
      var reactWrap = msgEl.querySelector('.msg-reactions');
      if (reactWrap) {
        reactWrap.innerHTML = '';
        Object.keys(resp.reactions).forEach(function (emoji) {
          var r = resp.reactions[emoji];
          var span = document.createElement('span');
          span.className = 'reaction-badge';
          span.textContent = emoji + ' ' + r.count;
          reactWrap.appendChild(span);
        });
      }
    }
  }).catch(function () { });
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
// Sidebar dropdown menu
function toggleSbMenu(e) {
  e.stopPropagation();
  var dd = $('sb-dropdown');
  dd.classList.toggle('open');
  // Close on outside click
  if (dd.classList.contains('open')) {
    setTimeout(function () {
      document.addEventListener('click', closeSbMenu);
    }, 0);
  }
}
function closeSbMenu() {
  var dd = $('sb-dropdown');
  if (dd) dd.classList.remove('open');
  document.removeEventListener('click', closeSbMenu);
}
function openNewGroup() {
  closeSbMenu();
  openM('cg-modal');
  $('cg-name').value = '';
  $('cg-srch').value = '';
  S.selectedGroupUsers = [];
  if (typeof updateSelectedUsers === 'function') updateSelectedUsers();
  if (typeof loadGroupUsersList === 'function') loadGroupUsersList();
}

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
      var av = getAvatar(u);
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
      var av = getAvatar(u);
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
    var av = getAvatar(u);
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

// ═══════════════════════════════════════════════════════════════
// GROUP INFO PANEL
// ═══════════════════════════════════════════════════════════════

// ===================== INFO SIDE PANEL =====================

function openContactInfo(user) {
  var panel = $('info-panel');
  if (!panel) return;
  if (window.innerWidth <= 768) history.pushState({ view: 'info' }, '');
  $('ip-header-title').textContent = 'Contact info';
  $('ip-avatar').src = getAvatar(user);
  $('ip-name').textContent = dname(user);
  $('ip-sub').textContent = user.is_online ? 'Online' : lastSeenStr(user.last_seen);
  $('ip-sub').className = 'ip-sub' + (user.is_online ? ' online' : '');
  // Actions
  $('ip-actions').style.display = '';
  // About
  var aboutSec = $('ip-about-section');
  if (aboutSec) aboutSec.style.display = 'none';
  // Hide group sections
  $('ip-members-section').style.display = 'none';
  $('ip-leave-section').style.display = 'none';
  // Load media
  loadInfoMedia('/contact_media/' + user.id + '/');
  panel.classList.add('open');
}

function openGroupInfo(groupId) {
  if (window.innerWidth <= 768) history.pushState({ view: 'info' }, '');
  var panel = $('info-panel');
  if (!panel) return;
  $('ip-header-title').textContent = 'Group info';
  $('ip-members').innerHTML = '<div style="padding:12px;text-align:center;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  $('ip-members-section').style.display = '';
  $('ip-leave-section').style.display = '';
  $('ip-actions').style.display = 'none';
  $('ip-about-section').style.display = 'none';
  panel.classList.add('open');

  api('/groups/' + groupId + '/info/')
    .then(function (data) {
      if (!data) return;
      $('ip-avatar').src = data.group_picture || seed(data.name);
      $('ip-name').textContent = data.name;
      $('ip-sub').textContent = data.member_count + ' members';
      $('ip-sub').className = 'ip-sub';
      if (data.description) {
        $('ip-about-section').style.display = '';
        $('ip-about').textContent = data.description;
      }
      var isAdmin = data.admins.indexOf(S.user.id) !== -1;
      var addBtn = $('ip-add-member-btn');
      if (addBtn) addBtn.style.display = isAdmin ? 'flex' : 'none';
      data.members.sort(function (a, b) {
        if (a.is_admin && !b.is_admin) return -1;
        if (!a.is_admin && b.is_admin) return 1;
        return (a.first_name || a.username).toLowerCase().localeCompare((b.first_name || b.username).toLowerCase());
      });
      var html = '';
      data.members.forEach(function (m) {
        var name = m.first_name ? (m.first_name + ' ' + (m.last_name || '')).trim() : m.username;
        var avUrl = m.profile_picture || seed((m.first_name || m.username) + ' ' + (m.last_name || ''));
        var isMe = m.id === S.user.id;
        var badge = m.is_admin ? '<span class="gi-admin-badge">Group admin</span>' : '';
        var statusText = m.is_online ? 'Online' : (m.last_seen ? lastSeenStr(m.last_seen) : '');
        var actions = '';
        if (isAdmin && !isMe) {
          actions = '<div class="gi-member-actions">';
          if (!m.is_admin) {
            actions += '<button class="gi-action-btn" onclick="makeGroupAdmin(' + groupId + ',' + m.id + ')" title="Make admin"><i class="fa-solid fa-shield-halved"></i></button>';
          } else {
            actions += '<button class="gi-action-btn" onclick="removeGroupAdmin(' + groupId + ',' + m.id + ')" title="Remove admin"><i class="fa-solid fa-shield"></i></button>';
          }
          actions += '<button class="gi-action-btn danger" onclick="removeGroupMember(' + groupId + ',' + m.id + ',\'' + esc(name) + '\')" title="Remove"><i class="fa-solid fa-user-minus"></i></button>';
          actions += '</div>';
        }
        html += '<div class="gi-member">' +
          '<img class="gi-member-av" src="' + esc(avUrl) + '">' +
          '<div class="gi-member-info">' +
            '<div class="gi-member-name">' + esc(isMe ? 'You' : name) + ' ' + badge + '</div>' +
            '<div class="gi-member-status ' + (m.is_online ? 'online' : '') + '">' + statusText + '</div>' +
          '</div>' + actions + '</div>';
      });
      $('ip-members').innerHTML = html;
      $('ip-leave-btn').onclick = function () { leaveGroup(groupId); };
    })
    .catch(function () { toast('Failed to load group info', 'e'); });

  loadInfoMedia('/group_media/' + groupId + '/');
}

function loadInfoMedia(endpoint) {
  var grid = $('ip-media-grid');
  var countEl = $('ip-media-count');
  grid.innerHTML = '<div style="padding:12px;text-align:center;color:var(--sub);font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  countEl.textContent = '';
  api(endpoint).then(function (items) {
    if (!items || !items.length) {
      grid.innerHTML = '<div style="padding:12px;text-align:center;color:var(--sub);font-size:13px;">No media yet</div>';
      countEl.textContent = '0';
      return;
    }
    countEl.textContent = items.length;
    var mediaItems = items.filter(function (i) { return i.type === 'image' || i.type === 'video'; });
    var docItems = items.filter(function (i) { return i.type !== 'image' && i.type !== 'video'; });
    var html = '';
    if (mediaItems.length) {
      html += '<div class="ip-media-thumbs">';
      mediaItems.forEach(function (m) {
        if (m.type === 'image') {
          html += '<div class="ip-media-thumb" onclick="openMedia(\'' + esc(m.url) + '\',\'image\')">' +
            '<img src="' + esc(m.url) + '" alt="">' + '</div>';
        } else if (m.type === 'video') {
          html += '<div class="ip-media-thumb" onclick="openMedia(\'' + esc(m.url) + '\',\'video\')">' +
            '<video src="' + esc(m.url) + '"></video>' +
            '<div class="ip-thumb-play"><i class="fa-solid fa-play"></i></div></div>';
        }
      });
      html += '</div>';
    }
    if (docItems.length) {
      html += '<div class="ip-docs-list">';
      docItems.forEach(function (d) {
        var icon = d.type === 'audio' || d.type === 'voice' ? 'fa-headphones' : 'fa-file';
        var size = d.size ? (d.size < 1024 * 1024 ? Math.round(d.size / 1024) + ' KB' : (d.size / (1024 * 1024)).toFixed(1) + ' MB') : '';
        html += '<div class="ip-doc-item" onclick="openFilePreview(\'' + esc(d.url) + '\',\'' + esc(d.name || 'file') + '\')">' +
          '<i class="fa-solid ' + icon + ' ip-doc-icon"></i>' +
          '<div class="ip-doc-info"><div class="ip-doc-name">' + esc(d.name || 'File') + '</div>' +
          '<div class="ip-doc-size">' + size + '</div></div></div>';
      });
      html += '</div>';
    }
    grid.innerHTML = html;
  }).catch(function () {
    grid.innerHTML = '<div style="padding:12px;text-align:center;color:var(--sub);font-size:13px;">Failed to load</div>';
  });
}

function closeInfoPanel() {
  var panel = $('info-panel');
  if (panel) panel.classList.remove('open');
}

function addGroupMember(groupId) {
  // Open add member modal
  $('gam-list').innerHTML = '<div style="padding:16px;text-align:center;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  openM('gam-modal');
  
  api('/all_users/')
    .then(function (users) {
      if (!users) return;
      
      // Filter out existing members
      var existingIds = S.activeGroup.members.map(function (m) { return m.id; });
      var available = users.filter(function (u) { return existingIds.indexOf(u.id) === -1; });
      
      if (!available.length) {
        $('gam-list').innerHTML = '<div style="padding:16px;text-align:center;color:var(--sub);">No users to add</div>';
        return;
      }
      
      var html = '';
      available.forEach(function (u) {
        var name = dname(u);
        var av = u.profile_picture || seed(u.username);
        html += '<div class="user-item" onclick="doAddGroupMember(' + groupId + ',' + u.id + ',\'' + esc(name).replace(/'/g, "\\'") + '\')">' +
          '<img class="user-av" src="' + esc(av) + '">' +
          '<div class="user-name">' + esc(name) + '</div>' +
        '</div>';
      });
      $('gam-list').innerHTML = html;
    });
}

function doAddGroupMember(groupId, userId, memberName) {
  api('/groups/' + groupId + '/add_member/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).then(function (data) {
    if (data && !data.error) {
      toast('Member added', 's');
      closeM('gam-modal');
      loadGroups();
      openGroupInfo(groupId);
      
      // Send system message via WS
      if (S.ws && S.ws.readyState === WebSocket.OPEN) {
        var adder = S.user.first_name || S.user.username;
        var added = memberName || 'a member';
        S.ws.send(JSON.stringify({
          type: 'group_system',
          action: 'add_member',
          group_id: groupId,
          target_user_id: userId,
          system_message: adder + ' added ' + added
        }));
      }
    } else {
      toast(data.error || 'Failed', 'e');
    }
  });
}

function removeGroupMember(groupId, userId, name) {
  if (!confirm('Remove ' + name + ' from the group?')) return;
  
  api('/groups/' + groupId + '/remove_member/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).then(function (data) {
    if (data && !data.error) {
      toast('Member removed', 's');
      loadGroups();
      openGroupInfo(groupId);
      
      // Update local group data
      if (S.activeGroup) {
        S.activeGroup.members = data.members;
        S.activeGroup.admins = data.admins;
      }
    } else {
      toast(data.error || 'Failed', 'e');
    }
  });
}

function makeGroupAdmin(groupId, userId) {
  api('/groups/' + groupId + '/make_admin/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).then(function (data) {
    if (data && !data.error) {
      toast('Admin added', 's');
      openGroupInfo(groupId);
    } else {
      toast(data.error || 'Failed', 'e');
    }
  });
}

function removeGroupAdmin(groupId, userId) {
  api('/groups/' + groupId + '/remove_admin/', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId })
  }).then(function (data) {
    if (data && !data.error) {
      toast('Admin removed', 's');
      openGroupInfo(groupId);
    } else {
      toast(data.error || 'Failed', 'e');
    }
  });
}

function leaveGroup(groupId) {
  if (!confirm('Leave this group?')) return;
  
  api('/groups/' + groupId + '/leave/', {
    method: 'POST'
  }).then(function (data) {
    if (data && !data.error) {
      toast('Left group', 's');
      closeM('gi-modal');
      S.activeGroup = null;
      S.isGroup = false;
      $('chat-view').classList.remove('active');
      $('empty-state').style.display = 'flex';
      loadGroups();
    } else {
      toast(data.error || 'Failed', 'e');
    }
  });
}

// String to color for group sender names
function strToColor(str) {
  var colors = ['#e91e63','#9c27b0','#673ab7','#3f51b5','#2196f3','#00bcd4','#009688','#4caf50','#ff9800','#ff5722','#795548','#607d8b'];
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Tab switching
function swTab(tab, btn) {
  S.currentTab = tab;
  document.querySelectorAll('.sb-tab').forEach(function (b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');

  $('search-inp').value = '';

  // Immediately clear the list before loading new data
  $('conv-list').innerHTML = '<div style="padding:28px;text-align:center;color:var(--sub);"><i class="fa-solid fa-spinner fa-spin" style="font-size:22px;color:var(--blue);"></i></div>';

  if (tab === 'chats' || tab === 'unread') {
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
    if (call.type === 'group') return renderGroupCallItem(call);
    return renderDmCallItem(call);
  }).join('');
}

function renderDmCallItem(call) {
    var user = call.other_user;
    if (!user) return '';

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

    var av = user.profile_picture || null;
    var initial = (name[0] || 'U').toUpperCase();

    var isOutgoing = !!call.is_outgoing;
    var status = call.status || '';
    var isVideo = call.call_type === 'video';

    var isCompleted = status === 'completed' || status === 'accepted';
    var isMissed = !isOutgoing && (status === 'missed' || status === 'rejected' || status === 'pending');
    var isCancelled = isOutgoing && (status === 'cancelled' || status === 'missed' || status === 'pending');

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

    var timeStr = callTimeStr(call.created_at);
    var durationStr = callDurationStr(call.duration);
    var callIcon = isVideo ? 'fa-video' : 'fa-phone';

    return `
      <div class="call-item" onclick="callUser(${user.id}, '${call.call_type}')">
        <div class="call-av-wrap">
          ${av
        ? `<img class="call-av" src="${esc(av)}" alt="${esc(name)}">`
        : `<div class="call-av-init">${initial}</div>`
      }
        </div>
        <div class="call-info">
          <div class="call-user-name ${isMissed ? 'missed' : ''}">${esc(name)}</div>
          <div class="call-meta">
            <i class="fa-solid ${arrowIcon}" style="color:${arrowColor}; font-size:11px;"></i>
            <span class="call-status-text ${isMissed ? 'missed-text' : ''}">
              ${esc(statusLabel)}${durationStr}
            </span>
          </div>
        </div>
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
}

function renderGroupCallItem(call) {
    var g = call.group;
    if (!g) return '';
    var gName = g.name || 'Group';
    var gPic = g.group_picture || null;
    var initial = (gName[0] || 'G').toUpperCase();
    var isVideo = call.call_type === 'video';
    var callIcon = isVideo ? 'fa-video' : 'fa-phone';
    var isActive = call.status === 'active';

    // Participants list (excluding self)
    var parts = (call.participants || []);
    var partNames = parts.map(function (p) { return p.name; });
    var partStr = '';
    if (partNames.length <= 3) {
      partStr = partNames.join(', ');
    } else {
      partStr = partNames.slice(0, 2).join(', ') + ' +' + (partNames.length - 2);
    }

    // Participant avatars (max 4)
    var avatarHtml = '';
    var showParts = parts.slice(0, 4);
    for (var i = 0; i < showParts.length; i++) {
      var p = showParts[i];
      if (p.profile_picture) {
        avatarHtml += '<img class="gc-hist-av" src="' + esc(p.profile_picture) + '" alt="" style="z-index:' + (10 - i) + ';">';
      } else {
        avatarHtml += '<div class="gc-hist-av gc-hist-av-init" style="z-index:' + (10 - i) + ';">' + (p.name[0] || 'U').toUpperCase() + '</div>';
      }
    }
    if (parts.length > 4) {
      avatarHtml += '<div class="gc-hist-av gc-hist-av-init gc-hist-av-more" style="z-index:1;">+' + (parts.length - 4) + '</div>';
    }

    var statusLabel = isVideo ? 'Group video call' : 'Group voice call';
    if (isActive) statusLabel += ' · Ongoing';
    var timeStr = callTimeStr(call.created_at);
    var durationStr = callDurationStr(call.duration);

    return `
      <div class="call-item gc-call-item" onclick="openGroup(${g.id})">
        <div class="call-av-wrap">
          ${gPic
        ? '<img class="call-av" src="' + esc(gPic) + '" alt="' + esc(gName) + '">'
        : '<div class="call-av-init">' + initial + '</div>'
      }
          <div class="gc-call-badge"><i class="fa-solid fa-users" style="font-size:8px;"></i></div>
        </div>
        <div class="call-info">
          <div class="call-user-name">${esc(gName)}</div>
          <div class="call-meta">
            <i class="fa-solid fa-users" style="color:#25d366; font-size:11px;"></i>
            <span class="call-status-text">${esc(statusLabel)}${durationStr}</span>
          </div>
          <div class="gc-hist-parts">
            <div class="gc-hist-avs">${avatarHtml}</div>
            <span class="gc-hist-names">${esc(partStr)}</span>
          </div>
        </div>
        <div class="call-right">
          <div class="call-time">${timeStr}</div>
          <button class="call-action-btn ${isVideo ? 'video' : 'voice'}"
            onclick="event.stopPropagation(); openGroup(${g.id})"
            title="${isVideo ? 'Video call' : 'Voice call'}">
            <i class="fa-solid ${callIcon}"></i>
          </button>
        </div>
      </div>`;
}

function callTimeStr(dateStr) {
    var callDate = new Date(dateStr);
    var now = new Date();
    var yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (callDate.toDateString() === now.toDateString()) {
      return callDate.toLocaleTimeString('en-PK', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: PKT
      });
    } else if (callDate.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return callDate.toLocaleDateString('en-PK', {
        day: 'numeric', month: 'short', timeZone: PKT
      });
    }
}

function callDurationStr(dur) {
    if (!dur || dur <= 0) return '';
    var dm = Math.floor(dur / 60);
    var ds = dur % 60;
    return ' (' + dm + ':' + (ds < 10 ? '0' : '') + ds + ')';
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
    $('pf-av').src = S.user.profile_picture || seed((S.user.first_name || S.user.username) + ' ' + (S.user.last_name || ''));
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

function goBack(skipHistory) {
  // Check if info panel is open — close it first
  var infoPanel = $('info-panel');
  if (infoPanel && infoPanel.classList.contains('open')) {
    closeInfoPanel();
    return;
  }
  // Check if any modal is open — close it first
  var openModal = document.querySelector('.modal-bg.open');
  if (openModal) {
    openModal.classList.remove('open');
    return;
  }
  closeInfoPanel();
  closeTbMenu();
  document.getElementById('sidebar').style.display = '';
  document.getElementById('chat-panel').style.removeProperty('display');
  document.getElementById('chat-panel').classList.remove('active');
  document.getElementById('back-btn').style.display = 'none';
  S.activeUser = null;
  S.activeGroup = null;
}

// Browser / mobile back button handler
window.addEventListener('popstate', function (e) {
  if (window.innerWidth > 768) return;
  var state = e.state;

  // Check if any modal is open
  var openModal = document.querySelector('.modal-bg.open');
  if (openModal) {
    openModal.classList.remove('open');
    return;
  }

  // Info panel open? Close it
  var infoPanel = $('info-panel');
  if (infoPanel && infoPanel.classList.contains('open')) {
    closeInfoPanel();
    return;
  }

  // Chat panel open? Go back to sidebar
  var chatPanel = document.getElementById('chat-panel');
  if (chatPanel && chatPanel.classList.contains('active')) {
    closeInfoPanel();
    closeTbMenu();
    document.getElementById('sidebar').style.display = '';
    chatPanel.style.removeProperty('display');
    chatPanel.classList.remove('active');
    document.getElementById('back-btn').style.display = 'none';
    S.activeUser = null;
    S.activeGroup = null;
    return;
  }
});

// Set initial state so we have something to pop back to
if (window.innerWidth <= 768) {
  history.replaceState({ view: 'home' }, '');
}

/* ── Topbar 3-dot dropdown ── */
function toggleTbMenu(e) {
  e.stopPropagation();
  var dd = $('tb-dropdown');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) {
    setTimeout(function () {
      document.addEventListener('click', closeTbMenu);
    }, 0);
  }
}
function closeTbMenu() {
  var dd = $('tb-dropdown');
  if (dd) dd.classList.remove('open');
  document.removeEventListener('click', closeTbMenu);
}
function openContactOrGroupInfo() {
  if (S.activeGroup) {
    openGroupInfo(S.activeGroup.id);
  } else if (S.activeUser) {
    openContactInfo(S.activeUser);
  }
}
function closeChat() {
  goBack();
}
function deleteCurrentChat() {
  var isGroup = !!S.activeGroup;
  var name = isGroup ? S.activeGroup.name : (S.activeUser ? S.activeUser.username : 'this chat');
  if (!confirm('Delete entire chat with "' + name + '"? This cannot be undone.')) return;
  var path;
  if (isGroup) {
    path = '/delete_group/' + S.activeGroup.id + '/';
  } else if (S.activeUser) {
    path = '/delete_conversation/' + S.activeUser.id + '/';
  } else return;
  api(path, { method: 'POST', body: '{}' })
    .then(function (data) {
      if (!data) return;
      toast('Chat deleted', 's');
      goBack();
      loadConvos();
      if (isGroup) loadGroups();
    })
    .catch(function () { toast('Failed to delete chat', 'e'); });
}
// Modal management
function openM(id) {
  $(id).classList.add('open');
  if (window.innerWidth <= 768) history.pushState({ view: 'modal', modalId: id }, '');
}
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
  isSpeakerOff: false,
  remoteProfilePic: null,
  isScreenSharing: false,
  screenStream: null,
  originalVideoTrack: null
};

var rtcConfig = {
  iceServers: [], // loadTURNServers fill karega
  iceTransportPolicy: 'all'
};

// TURN credentials dynamically load
// TURN ready flag
var turnReady = true;

function loadTURNServers(cb) {
  // TURN servers are statically configured below; this keeps caller flow safe.
  turnReady = true;
  if (typeof cb === 'function') cb();
}

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
  console.log('startCall called with type:', type, 'activeUser:', S.activeUser, 'activeGroup:', S.activeGroup, 'isInCall:', CallState.isInCall);
  
  // Group call
  if (S.activeGroup && S.isGroup) {
    startGroupCall(type);
    return;
  }
  
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
  CallState.remoteProfilePic = S.activeUser.profile_picture || seed(CallState.remoteUserName);
  console.log('Starting call to:', CallState.remoteUserName, 'ID:', CallState.remoteUserId);

  // Check permissions first
  checkMediaPermissions(type).then(function (result) {
    if (!result.success) {
      toast(result.error, 'e');
      return;
    }

    // Show outgoing call UI
    $('outgoing-av').src = S.activeUser.profile_picture || seed(CallState.remoteUserName);
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
  CallState.remoteProfilePic = data.caller_profile_picture || seed(data.caller_name || data.caller_username || 'User');

  // Show incoming call UI
  $('incoming-av').src = CallState.remoteProfilePic;
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
  // If minimized, update PIP state instead of showing full overlay
  if (callMinimized && minimizedOverlayId === 'outgoing-call') {
    minimizedOverlayId = 'ongoing-call';
    // Update PIP for ongoing state
    if (CallState.callType === 'video' && CallState.remoteStream) {
      $('pip-video-wrap').classList.add('active');
      $('pip-voice-wrap').classList.remove('active');
      $('pip-remote-video').srcObject = CallState.remoteStream;
    }
    CallState.callStartTime = Date.now();
    CallState.timerInterval = setInterval(updateCallTimer, 1000);
    return;
  }

  hideAllCallOverlays();

  var ongoingAv = $('ongoing-av');
  if (ongoingAv) {
    ongoingAv.src = CallState.remoteProfilePic || seed('User');
    ongoingAv.style.display = CallState.callType === 'video' ? 'none' : 'block';
  }

  var ongoingName = $('ongoing-name');
  if (ongoingName) ongoingName.textContent = CallState.remoteUserName;

  showCallOverlay('ongoing-call');

  CallState.callStartTime = Date.now();
  CallState.timerInterval = setInterval(updateCallTimer, 1000);
  updateCallTimer();

  if (CallState.callType === 'video') {
    if ($('local-video')) {
      $('local-video').style.display = 'block';
      $('local-video').srcObject = CallState.localStream;
    }
    if ($('remote-video')) {
      $('remote-video').style.display = 'block';
      if (CallState.remoteStream) {
        $('remote-video').srcObject = CallState.remoteStream;
      }
    }
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

// ═══ SCREEN SHARE (1:1) ═══
function toggleScreenShare() {
  if (CallState.isScreenSharing) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
}

function startScreenShare() {
  if (!CallState.pc || !CallState.isInCall) return;
  navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (screenStream) {
    CallState.screenStream = screenStream;
    CallState.isScreenSharing = true;
    var screenTrack = screenStream.getVideoTracks()[0];
    // Save original camera track
    var senders = CallState.pc.getSenders();
    var videoSender = null;
    for (var i = 0; i < senders.length; i++) {
      if (senders[i].track && senders[i].track.kind === 'video') {
        videoSender = senders[i];
        break;
      }
    }
    if (videoSender) {
      CallState.originalVideoTrack = videoSender.track;
      videoSender.replaceTrack(screenTrack);
    } else if (CallState.pc.addTrack) {
      // Voice call — no video sender exists, add one
      CallState.pc.addTrack(screenTrack, screenStream);
    }
    // Show screen in local video preview
    var localVid = $('local-video');
    if (localVid) { localVid.srcObject = screenStream; localVid.style.display = ''; }
    // Update button
    updateScreenBtn(true);
    // When user stops sharing from browser UI
    screenTrack.onended = function () { stopScreenShare(); };
  }).catch(function (err) {
    console.log('Screen share cancelled or error:', err);
  });
}

function stopScreenShare() {
  if (!CallState.isScreenSharing) return;
  CallState.isScreenSharing = false;
  // Stop screen tracks
  if (CallState.screenStream) {
    CallState.screenStream.getTracks().forEach(function (t) { t.stop(); });
    CallState.screenStream = null;
  }
  // Restore camera track
  if (CallState.originalVideoTrack && CallState.pc) {
    var senders = CallState.pc.getSenders();
    for (var i = 0; i < senders.length; i++) {
      if (senders[i].track && senders[i].track.kind === 'video') {
        senders[i].replaceTrack(CallState.originalVideoTrack);
        break;
      }
    }
  }
  // Restore local video preview
  var localVid = $('local-video');
  if (localVid && CallState.localStream) {
    localVid.srcObject = CallState.localStream;
    if (CallState.callType === 'voice') localVid.style.display = 'none';
  }
  CallState.originalVideoTrack = null;
  updateScreenBtn(false);
}

function updateScreenBtn(active) {
  var btn = $('screen-btn');
  if (btn) {
    btn.classList.toggle('screen-active', active);
    btn.innerHTML = active ? '<i class="fa-solid fa-display"></i><span class="screen-dot"></span>' : '<i class="fa-solid fa-display"></i>';
  }
}

function showCallOverlay(id) {
  $(id).classList.add('active');
}

function hideAllCallOverlays() {
  ['incoming-call', 'outgoing-call', 'ongoing-call', 'gc-incoming-call', 'gc-ongoing-call'].forEach(function (id) {
    var el = $(id);
    if (el) el.classList.remove('active');
  });
  // Hide outgoing local video preview
  var localWrap = $('outgoing-local-wrap');
  if (localWrap) localWrap.classList.remove('active');
  // Clear outgoing local video
  var outgoingVideo = $('outgoing-local-video');
  if (outgoingVideo) outgoingVideo.srcObject = null;
  // Also hide PIP widget
  var pip = $('call-pip');
  if (pip) pip.classList.remove('active');
  callMinimized = false;
  minimizedOverlayId = null;
  if (pipTimerInterval) {
    clearInterval(pipTimerInterval);
    pipTimerInterval = null;
  }
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
  if (CallState.screenStream) {
    CallState.screenStream.getTracks().forEach(function (t) { t.stop(); });
  }
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
  CallState.remoteProfilePic = null;
  CallState.isScreenSharing = false;
  CallState.screenStream = null;
  CallState.originalVideoTrack = null;
}

// ═══════════════════════════════════════════════════════════════
// CALL MINIMIZE / PIP (WhatsApp style)
// ═══════════════════════════════════════════════════════════════

var callMinimized = false;
var minimizedOverlayId = null; // which overlay was active before minimize
var pipTimerInterval = null;

function minimizeCall() {
  // Determine which overlay is currently showing
  var overlays = ['outgoing-call', 'ongoing-call'];
  var activeOverlay = null;
  overlays.forEach(function (id) {
    var el = $(id);
    if (el && el.classList.contains('active')) activeOverlay = id;
  });
  if (!activeOverlay) return;

  minimizedOverlayId = activeOverlay;
  callMinimized = true;

  // Hide the full-screen overlay
  $(activeOverlay).classList.remove('active');

  // Setup PIP widget
  var pip = $('call-pip');

  // Name
  $('pip-name').textContent = CallState.remoteUserName || 'Call';

  // Avatar
  $('pip-avatar').src = CallState.remoteProfilePic || seed(CallState.remoteUserName || 'User');

  // Show video or voice mode
  var videoWrap = $('pip-video-wrap');
  var voiceWrap = $('pip-voice-wrap');

  if (CallState.callType === 'video' && CallState.remoteStream) {
    videoWrap.classList.add('active');
    voiceWrap.classList.remove('active');
    $('pip-remote-video').srcObject = CallState.remoteStream;
  } else {
    videoWrap.classList.remove('active');
    voiceWrap.classList.add('active');
  }

  // Update mic button state
  updatePipMic();

  // Start PIP timer sync
  syncPipTimer();
  pipTimerInterval = setInterval(syncPipTimer, 1000);

  pip.classList.add('active');

  // Make PIP draggable
  makePipDraggable(pip);
}

function minimizeGroupCall() {
  var overlay = $('gc-ongoing-call');
  if (!overlay || !overlay.classList.contains('active')) return;

  minimizedOverlayId = 'gc-ongoing-call';
  callMinimized = true;

  overlay.classList.remove('active');

  var pip = $('call-pip');
  $('pip-name').textContent = $('gc-call-name').textContent || 'Group Call';
  $('pip-avatar').src = seed('Group');

  $('pip-video-wrap').classList.remove('active');
  $('pip-voice-wrap').classList.add('active');

  updatePipMic();
  syncPipTimer();
  pipTimerInterval = setInterval(syncPipTimer, 1000);

  pip.classList.add('active');
  makePipDraggable(pip);
}

function expandCall() {
  if (!minimizedOverlayId) return;

  // Hide PIP
  var pip = $('call-pip');
  pip.classList.remove('active');
  callMinimized = false;

  if (pipTimerInterval) {
    clearInterval(pipTimerInterval);
    pipTimerInterval = null;
  }

  // Restore video to original elements
  if (CallState.remoteStream) {
    var remoteVideo = $('remote-video');
    if (remoteVideo) remoteVideo.srcObject = CallState.remoteStream;
  }

  // Show the overlay back
  var overlay = $(minimizedOverlayId);
  if (overlay) overlay.classList.add('active');

  minimizedOverlayId = null;
}

function pipEndCall() {
  var pip = $('call-pip');
  pip.classList.remove('active');
  callMinimized = false;
  if (pipTimerInterval) {
    clearInterval(pipTimerInterval);
    pipTimerInterval = null;
  }

  if (minimizedOverlayId === 'gc-ongoing-call') {
    minimizedOverlayId = null;
    leaveGroupCall();
  } else if (minimizedOverlayId === 'outgoing-call') {
    minimizedOverlayId = null;
    cancelCall();
  } else {
    minimizedOverlayId = null;
    endCall();
  }
}

function syncPipTimer() {
  var timerEl = $('pip-timer');
  if (!timerEl) return;

  // For 1:1 calls
  if (CallState.callStartTime) {
    var elapsed = Math.floor((Date.now() - CallState.callStartTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    timerEl.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
  } else if (minimizedOverlayId === 'outgoing-call') {
    timerEl.textContent = 'Ringing...';
  } else if (GC.callStartTime && minimizedOverlayId === 'gc-ongoing-call') {
    var elapsed = Math.floor((Date.now() - GC.callStartTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    timerEl.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
  } else {
    timerEl.textContent = 'Connecting...';
  }
}

function updatePipMic() {
  var btn = $('pip-mic-btn');
  if (!btn) return;
  var muted = minimizedOverlayId === 'gc-ongoing-call' ? GC.isMuted : CallState.isMuted;
  btn.classList.toggle('muted', muted);
  btn.innerHTML = muted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
}

// Draggable PIP
function makePipDraggable(pip) {
  if (pip._dragInit) return;
  pip._dragInit = true;
  var isDragging = false, startX, startY, origX, origY;

  pip.addEventListener('mousedown', function (e) {
    if (e.target.closest('.call-pip-btn')) return;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    var rect = pip.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    pip.classList.add('dragging');

    function onMove(e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging = true;
      pip.style.left = (origX + dx) + 'px';
      pip.style.top = (origY + dy) + 'px';
      pip.style.right = 'auto';
      pip.style.bottom = 'auto';
    }
    function onUp() {
      pip.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (isDragging) {
        // Snap to nearest edge
        var r = pip.getBoundingClientRect();
        var midX = r.left + r.width / 2;
        if (midX > window.innerWidth / 2) {
          pip.style.left = 'auto';
          pip.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        } else {
          pip.style.right = 'auto';
          pip.style.left = Math.max(8, r.left) + 'px';
        }
        pip.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, r.top)) + 'px';
        pip.style.bottom = 'auto';
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch support
  pip.addEventListener('touchstart', function (e) {
    if (e.target.closest('.call-pip-btn')) return;
    var touch = e.touches[0];
    isDragging = false;
    startX = touch.clientX;
    startY = touch.clientY;
    var rect = pip.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    pip.classList.add('dragging');

    function onTouchMove(e) {
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging = true;
      pip.style.left = (origX + dx) + 'px';
      pip.style.top = (origY + dy) + 'px';
      pip.style.right = 'auto';
      pip.style.bottom = 'auto';
      if (isDragging) e.preventDefault();
    }
    function onTouchEnd() {
      pip.classList.remove('dragging');
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (isDragging) {
        var r = pip.getBoundingClientRect();
        var midX = r.left + r.width / 2;
        if (midX > window.innerWidth / 2) {
          pip.style.left = 'auto';
          pip.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        } else {
          pip.style.right = 'auto';
          pip.style.left = Math.max(8, r.left) + 'px';
        }
        pip.style.top = Math.max(8, Math.min(window.innerHeight - r.height - 8, r.top)) + 'px';
        pip.style.bottom = 'auto';
      }
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════
// GROUP CALL FUNCTIONALITY (WebRTC Mesh)
// ═══════════════════════════════════════════════════════════════

var GC = {
  active: false,
  groupCallId: null,
  groupId: null,
  callType: null,
  localStream: null,
  peers: {},         // { peerId: { pc, stream, name, pic } }
  timerInterval: null,
  callStartTime: null,
  isMuted: false,
  isCamOff: false,
  activeGroupCalls: {},  // { groupId: { group_call_id, call_type, caller_name, group_name } }
  isScreenSharing: false,
  screenStream: null,
  originalVideoTrack: null,
};

function startGroupCall(type) {
  if (GC.active) { toast('Already in a call', 'e'); return; }
  if (!S.activeGroup) return;

  if (!turnReady) {
    toast('Connecting... please wait', 'i');
    loadTURNServers(function () { startGroupCall(type); });
    return;
  }

  GC.callType = type;
  GC.groupId = S.activeGroup.id;

  checkMediaPermissions(type).then(function (result) {
    if (!result.success) { toast(result.error, 'e'); return; }
    var constraints = { audio: { echoCancellation: true, noiseSuppression: true } };
    if (type === 'video') constraints.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };

    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      GC.localStream = stream;
      GC.active = true;
      // Send start signal via global WS
      if (S.globalWs && S.globalWs.readyState === 1) {
        S.globalWs.send(JSON.stringify({
          type: 'group_call_start',
          group_id: S.activeGroup.id,
          call_type: type,
        }));
      }
    }).catch(function (err) {
      console.error('getUserMedia error:', err);
      toast('Could not access camera/mic', 'e');
    });
  });
}

function handleGroupCallStarted(data) {
  GC.groupCallId = data.group_call_id;
  GC.groupId = data.group_id;
  GC.callType = data.call_type;
  GC.callStartTime = Date.now();
  // Join call on server
  if (S.globalWs && S.globalWs.readyState === 1) {
    S.globalWs.send(JSON.stringify({
      type: 'group_call_join',
      group_call_id: GC.groupCallId,
    }));
  }
  showGroupCallUI();
}

function handleGroupCallNotify(data) {
  console.log('[GC-DEBUG] handleGroupCallNotify called', data);
  // Store active group call info
  GC.activeGroupCalls[data.group_id] = {
    group_call_id: data.group_call_id,
    call_type: data.call_type,
    caller_name: data.caller_name,
    group_name: data.group_name,
    caller_pic: data.caller_pic,
  };
  // If currently viewing this group, show join banner
  updateGroupCallBanner();
  // Show persistent popup notification with Join button
  showGroupCallPopup(data);
  // Show browser notification when tab is in background
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    var callLabel = data.call_type === 'video' ? 'Video' : 'Voice';
    var n = new Notification(data.group_name, {
      body: data.caller_name + ' started a ' + callLabel + ' call',
      icon: data.caller_pic || '/static/icons/icon-192x192.png',
      tag: 'gc-notify-' + data.group_id,
      requireInteraction: true,
      silent: false,
    });
    n.onclick = function () {
      window.focus();
      n.close();
      // Auto open the group
      openGroup(data.group_id);
    };
    // Store reference to close it later
    GC.activeGroupCalls[data.group_id]._notif = n;
  }
}

function dismissGroupCallPopup(groupId) {
  var popup = document.getElementById('gc-popup-' + groupId);
  if (popup) {
    popup.style.animation = 'slideOutRight 0.4s ease';
    setTimeout(function () { if (popup.parentElement) popup.remove(); }, 400);
  }
  // Close browser notification if any
  var info = GC.activeGroupCalls[groupId];
  if (info && info._notif) { try { info._notif.close(); } catch(e){} }
  stopGcRingtone();
}

function stopGcRingtone() {
  var anyPopup = document.querySelector('.gc-call-popup');
  if (!anyPopup) {
    var rt = $('ringtone');
    if (rt) { rt.pause(); rt.currentTime = 0; }
  }
}

function playGcRingtone() {
  var ringtone = $('ringtone');
  console.log('[GC-DEBUG] playGcRingtone called, ringtone element=', ringtone, 'readyState=', ringtone ? ringtone.readyState : 'N/A');
  if (!ringtone) return;
  // If audio not loaded yet, load it first
  if (ringtone.readyState < 2) {
    ringtone.load();
    ringtone.addEventListener('canplay', function onCanPlay() {
      ringtone.removeEventListener('canplay', onCanPlay);
      ringtone.currentTime = 0;
      ringtone.play().then(function() {
        console.log('[GC-DEBUG] Ringtone playing OK (after load)');
      }).catch(function (e) { console.warn('[GC-DEBUG] Ringtone play FAILED after load:', e); });
    }, { once: true });
  } else {
    ringtone.currentTime = 0;
    ringtone.play().then(function() {
      console.log('[GC-DEBUG] Ringtone playing OK');
    }).catch(function (e) { console.warn('[GC-DEBUG] Ringtone play FAILED:', e); });
  }
}

function showGroupCallPopup(data) {
  console.log('[GC-DEBUG] showGroupCallPopup called, GC.active=', GC.active, 'CallState.isInCall=', CallState.isInCall);
  if (GC.active || CallState.isInCall) return; // already in a call

  var container = $('notif-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notif-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column-reverse;gap:10px;max-width:380px;';
    document.body.appendChild(container);
  }

  // Remove existing group call popup for same group if any
  var old = document.getElementById('gc-popup-' + data.group_id);
  if (old) old.remove();

  var callIcon = data.call_type === 'video' ? 'fa-video' : 'fa-phone';
  var callLabel = data.call_type === 'video' ? 'Video' : 'Voice';
  var pic = data.caller_pic || seed(data.group_name || 'Group');

  var notif = document.createElement('div');
  notif.id = 'gc-popup-' + data.group_id;
  notif.className = 'gc-call-popup';
  notif.innerHTML =
    '<div class="gc-popup-top">' +
      '<img class="gc-popup-av" src="' + esc(pic) + '" alt="">' +
      '<div class="gc-popup-info">' +
        '<div class="gc-popup-group">' + esc(data.group_name) + '</div>' +
        '<div class="gc-popup-caller"><i class="fa-solid ' + callIcon + '"></i> ' + esc(data.caller_name) + ' started a ' + callLabel + ' call</div>' +
      '</div>' +
      '<button class="gc-popup-close"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>' +
    '<div class="gc-popup-actions">' +
      '<button class="gc-popup-btn gc-popup-dismiss">Dismiss</button>' +
      '<button class="gc-popup-btn gc-popup-join">Join</button>' +
    '</div>';

  container.appendChild(notif);

  // Play ringtone
  playGcRingtone();

  // Close / Dismiss buttons
  notif.querySelector('.gc-popup-close').onclick = function (e) {
    e.stopPropagation();
    dismissGroupCallPopup(data.group_id);
  };
  notif.querySelector('.gc-popup-dismiss').onclick = function (e) {
    e.stopPropagation();
    dismissGroupCallPopup(data.group_id);
  };

  // Join button handler
  notif.querySelector('.gc-popup-join').onclick = function (e) {
    e.stopPropagation();
    notif.remove();
    stopGcRingtone();
    // Navigate to the group first
    openGroup(data.group_id);
    // Then join
    setTimeout(function () { joinGroupCallFromBanner(); }, 300);
  };

  // Auto-remove after 30 seconds
  setTimeout(function () {
    if (notif.parentElement) dismissGroupCallPopup(data.group_id);
  }, 30000);
}

function handleGroupCallEnded(data) {
  // Close browser notification if any
  var info = GC.activeGroupCalls[data.group_id];
  if (info && info._notif) { try { info._notif.close(); } catch(e){} }
  delete GC.activeGroupCalls[data.group_id];
  updateGroupCallBanner();
  // Remove popup notification and stop ringtone
  var popup = document.getElementById('gc-popup-' + data.group_id);
  if (popup) popup.remove();
  stopGcRingtone();
}

function updateGroupCallBanner() {
  var banner = $('gc-join-banner');
  if (!banner) return;
  // Show banner if viewing a group that has an active call and we're not already in it
  if (S.isGroup && S.activeGroup && GC.activeGroupCalls[S.activeGroup.id] && !(GC.active && GC.groupId === S.activeGroup.id)) {
    var info = GC.activeGroupCalls[S.activeGroup.id];
    var callIcon = info.call_type === 'video' ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-phone"></i>';
    var callLabel = info.call_type === 'video' ? 'Video' : 'Voice';
    $('gc-banner-text').innerHTML = callIcon + ' ' + callLabel + ' call &middot; ' + info.caller_name;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function joinGroupCallFromBanner() {
  if (!S.isGroup || !S.activeGroup) return;
  var info = GC.activeGroupCalls[S.activeGroup.id];
  if (!info) { toast('Call has ended', 'e'); return; }
  if (GC.active) { toast('Already in a call', 'e'); return; }
  if (CallState.isInCall) { toast('Already in a call', 'e'); return; }

  if (!turnReady) {
    toast('Connecting... please wait', 'i');
    loadTURNServers(function () { joinGroupCallFromBanner(); });
    return;
  }

  var callType = info.call_type;
  GC.groupCallId = info.group_call_id;
  GC.groupId = S.activeGroup.id;
  GC.callType = callType;

  var constraints = { audio: { echoCancellation: true, noiseSuppression: true } };
  if (callType === 'video') constraints.video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' };

  navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
    GC.localStream = stream;
    GC.active = true;
    GC.callStartTime = Date.now();
    if (S.globalWs && S.globalWs.readyState === 1) {
      S.globalWs.send(JSON.stringify({
        type: 'group_call_join',
        group_call_id: GC.groupCallId,
      }));
    }
    // Remove from active calls map (we're in it now)
    delete GC.activeGroupCalls[S.activeGroup.id];
    showGroupCallUI();
  }).catch(function () {
    toast('Could not access camera/mic', 'e');
  });
}

function handleGroupCallJoined(data) {
  // We joined — create peer connections to all existing participants
  var participants = data.participants || [];
  participants.forEach(function (p) {
    createGroupPeer(p.id, p.name, p.pic, true);
  });
}

function handleGroupCallUserJoined(data) {
  // A new user joined — they will send us an offer, we wait
  // But let's create their peer entry (they'll initiate)
  toast(data.user_name + ' joined the call', 's');
  updateGroupCallParticipantCount();
}

function handleGroupCallOffer(data) {
  var fromId = data.from_user_id;
  // Create peer for this user (we are the receiver of the offer)
  var peer = GC.peers[fromId];
  if (!peer) {
    peer = createGroupPeerConnection(fromId);
    GC.peers[fromId] = peer;
  }
  var pc = peer.pc;
  pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
    return pc.createAnswer();
  }).then(function (answer) {
    return pc.setLocalDescription(answer);
  }).then(function () {
    if (S.globalWs && S.globalWs.readyState === 1) {
      S.globalWs.send(JSON.stringify({
        type: 'group_call_answer',
        group_call_id: GC.groupCallId,
        target_user_id: fromId,
        sdp: pc.localDescription,
      }));
    }
    // Flush pending ICE
    if (peer.pendingIce) {
      peer.pendingIce.forEach(function (c) { pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); });
      peer.pendingIce = [];
    }
  }).catch(function (err) { console.error('Group offer handle error:', err); });
}

function handleGroupCallAnswer(data) {
  var fromId = data.from_user_id;
  var peer = GC.peers[fromId];
  if (!peer) return;
  peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function () {
    if (peer.pendingIce) {
      peer.pendingIce.forEach(function (c) { peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); });
      peer.pendingIce = [];
    }
  }).catch(function (err) { console.error('Group answer error:', err); });
}

function handleGroupCallIce(data) {
  var fromId = data.from_user_id;
  var peer = GC.peers[fromId];
  if (!peer) {
    // Peer not created yet, queue
    if (!GC.pendingIceByUser) GC.pendingIceByUser = {};
    if (!GC.pendingIceByUser[fromId]) GC.pendingIceByUser[fromId] = [];
    GC.pendingIceByUser[fromId].push(data.candidate);
    return;
  }
  if (peer.pc.remoteDescription) {
    peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function () {});
  } else {
    if (!peer.pendingIce) peer.pendingIce = [];
    peer.pendingIce.push(data.candidate);
  }
}

function handleGroupCallUserLeft(data) {
  var uid = data.user_id;
  if (GC.peers[uid]) {
    GC.peers[uid].pc.close();
    // Remove video/audio element
    var el = document.getElementById('gc-peer-' + uid);
    if (el) el.remove();
    delete GC.peers[uid];
  }
  updateGroupCallParticipantCount();
  // If no peers left, show waiting text
  if (Object.keys(GC.peers).length === 0) {
    var grid = $('gc-video-grid');
    if (grid && !grid.querySelector('.gc-peer-tile')) {
      // Only us left
    }
  }
}

function createGroupPeer(peerId, name, pic, isInitiator) {
  var peer = createGroupPeerConnection(peerId);
  peer.name = name;
  peer.pic = pic;
  GC.peers[peerId] = peer;

  if (isInitiator) {
    var pc = peer.pc;
    pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer);
    }).then(function () {
      if (S.globalWs && S.globalWs.readyState === 1) {
        S.globalWs.send(JSON.stringify({
          type: 'group_call_offer',
          group_call_id: GC.groupCallId,
          target_user_id: peerId,
          sdp: pc.localDescription,
        }));
      }
    }).catch(function (err) { console.error('Group offer create error:', err); });
  }
  return peer;
}

function createGroupPeerConnection(peerId) {
  var pc = new RTCPeerConnection(rtcConfig);
  var peer = { pc: pc, stream: null, pendingIce: [] };

  // Add pending ICE if any arrived before peer was created
  if (GC.pendingIceByUser && GC.pendingIceByUser[peerId]) {
    peer.pendingIce = GC.pendingIceByUser[peerId];
    delete GC.pendingIceByUser[peerId];
  }

  // Add local tracks
  if (GC.localStream) {
    GC.localStream.getTracks().forEach(function (track) {
      pc.addTrack(track, GC.localStream);
    });
  }

  pc.onicecandidate = function (event) {
    if (event.candidate && S.globalWs && S.globalWs.readyState === 1) {
      S.globalWs.send(JSON.stringify({
        type: 'group_call_ice',
        group_call_id: GC.groupCallId,
        target_user_id: peerId,
        candidate: event.candidate,
      }));
    }
  };

  pc.ontrack = function (event) {
    peer.stream = event.streams[0];
    renderGroupCallPeer(peerId, peer);
  };

  pc.onconnectionstatechange = function () {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.log('Peer ' + peerId + ' connection ' + pc.connectionState);
    }
  };

  return peer;
}

function renderGroupCallPeer(peerId, peer) {
  var existing = document.getElementById('gc-peer-' + peerId);
  if (existing) existing.remove();

  var tile = document.createElement('div');
  tile.className = 'gc-peer-tile';
  tile.id = 'gc-peer-' + peerId;

  if (GC.callType === 'video') {
    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = peer.stream;
    tile.appendChild(video);
  } else {
    var av = document.createElement('img');
    av.className = 'gc-peer-av';
    av.src = peer.pic || seed(peer.name || 'User');
    tile.appendChild(av);
    // Audio element
    var audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = peer.stream;
    tile.appendChild(audio);
  }

  var label = document.createElement('div');
  label.className = 'gc-peer-name';
  label.textContent = peer.name || 'User';
  tile.appendChild(label);

  $('gc-video-grid').appendChild(tile);
  updateGroupCallParticipantCount();
}

function showGroupCallUI() {
  hideAllCallOverlays();
  var localVid = $('gc-local-video');
  var localAv = $('gc-local-av');
  if (GC.callType === 'video' && GC.localStream) {
    if (localVid) { localVid.srcObject = GC.localStream; localVid.style.display = ''; }
    if (localAv) localAv.style.display = 'none';
  } else {
    // Voice call — show avatar, hide video
    if (localVid) localVid.style.display = 'none';
    if (localAv) {
      localAv.src = S.user && S.user.profile_picture ? S.user.profile_picture : seed(S.user ? (S.user.first_name || S.user.username) : 'You');
      localAv.style.display = '';
    }
  }
  $('gc-call-name').textContent = S.activeGroup ? S.activeGroup.name : 'Group Call';
  showCallOverlay('gc-ongoing-call');
  updateGcWaiting();
  updateGcGridLayout(Object.keys(GC.peers).length + 1);

  // Start timer
  GC.callStartTime = GC.callStartTime || Date.now();
  GC.timerInterval = setInterval(function () {
    var elapsed = Math.floor((Date.now() - GC.callStartTime) / 1000);
    var mins = Math.floor(elapsed / 60);
    var secs = elapsed % 60;
    $('gc-timer').textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
  }, 1000);
}

function updateGcWaiting() {
  var w = $('gc-waiting');
  if (!w) return;
  var peerCount = Object.keys(GC.peers).length;
  w.style.display = peerCount === 0 ? 'flex' : 'none';
}

function leaveGroupCall() {
  if (!GC.active) return;
  // Notify server
  if (S.globalWs && S.globalWs.readyState === 1) {
    S.globalWs.send(JSON.stringify({
      type: 'group_call_leave',
      group_call_id: GC.groupCallId,
    }));
  }
  cleanupGroupCall();
  hideAllCallOverlays();
  playEndSound();
}

function cleanupGroupCall() {
  if (GC.screenStream) {
    GC.screenStream.getTracks().forEach(function (t) { t.stop(); });
    GC.screenStream = null;
  }
  GC.isScreenSharing = false;
  GC.originalVideoTrack = null;
  Object.keys(GC.peers).forEach(function (pid) {
    if (GC.peers[pid].pc) GC.peers[pid].pc.close();
    var el = document.getElementById('gc-peer-' + pid);
    if (el) el.remove();
  });
  GC.peers = {};
  if (GC.localStream) {
    GC.localStream.getTracks().forEach(function (t) { t.stop(); });
  }
  if (GC.timerInterval) clearInterval(GC.timerInterval);
  var grid = $('gc-video-grid');
  if (grid) grid.innerHTML = '';
  var localVid = $('gc-local-video');
  if (localVid) localVid.srcObject = null;
  GC.active = false;
  GC.groupCallId = null;
  GC.groupId = null;
  GC.callType = null;
  GC.localStream = null;
  GC.timerInterval = null;
  GC.callStartTime = null;
  GC.isMuted = false;
  GC.isCamOff = false;
  GC.pendingIceByUser = {};
  updateGroupCallBanner();
}

function gcToggleMic() {
  GC.isMuted = !GC.isMuted;
  if (GC.localStream) {
    GC.localStream.getAudioTracks().forEach(function (t) { t.enabled = !GC.isMuted; });
  }
  var btn = $('gc-mic-btn');
  if (btn) {
    btn.classList.toggle('muted', GC.isMuted);
    btn.innerHTML = GC.isMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
  }
}

function gcToggleCam() {
  GC.isCamOff = !GC.isCamOff;
  if (GC.localStream) {
    GC.localStream.getVideoTracks().forEach(function (t) { t.enabled = !GC.isCamOff; });
  }
  var btn = $('gc-cam-btn');
  if (btn) {
    btn.classList.toggle('muted', GC.isCamOff);
    btn.innerHTML = GC.isCamOff ? '<i class="fa-solid fa-video-slash"></i>' : '<i class="fa-solid fa-video"></i>';
  }
}

// ═══ SCREEN SHARE (GROUP CALL) ═══
function gcToggleScreenShare() {
  if (GC.isScreenSharing) {
    gcStopScreenShare();
  } else {
    gcStartScreenShare();
  }
}

function gcStartScreenShare() {
  if (!GC.active) return;
  navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (screenStream) {
    GC.screenStream = screenStream;
    GC.isScreenSharing = true;
    var screenTrack = screenStream.getVideoTracks()[0];
    // Replace video track in all peer connections
    Object.keys(GC.peers).forEach(function (pid) {
      var pc = GC.peers[pid].pc;
      var senders = pc.getSenders();
      for (var i = 0; i < senders.length; i++) {
        if (senders[i].track && senders[i].track.kind === 'video') {
          if (!GC.originalVideoTrack) GC.originalVideoTrack = senders[i].track;
          senders[i].replaceTrack(screenTrack);
          break;
        }
      }
    });
    // Show screen share in local preview
    var localVid = $('gc-local-video');
    if (localVid) { localVid.srcObject = screenStream; localVid.style.display = ''; }
    var localAv = $('gc-local-av');
    if (localAv) localAv.style.display = 'none';
    // Update button
    var btn = $('gc-screen-btn');
    if (btn) { btn.classList.add('screen-active'); btn.innerHTML = '<i class="fa-solid fa-display"></i><span class="screen-dot"></span>'; }
    // When user stops from browser UI
    screenTrack.onended = function () { gcStopScreenShare(); };
  }).catch(function (err) {
    console.log('Screen share cancelled:', err);
  });
}

function gcStopScreenShare() {
  if (!GC.isScreenSharing) return;
  GC.isScreenSharing = false;
  if (GC.screenStream) {
    GC.screenStream.getTracks().forEach(function (t) { t.stop(); });
    GC.screenStream = null;
  }
  // Restore camera track in all peers
  if (GC.originalVideoTrack) {
    Object.keys(GC.peers).forEach(function (pid) {
      var pc = GC.peers[pid].pc;
      var senders = pc.getSenders();
      for (var i = 0; i < senders.length; i++) {
        if (senders[i].track && senders[i].track.kind === 'video') {
          senders[i].replaceTrack(GC.originalVideoTrack);
          break;
        }
      }
    });
  }
  GC.originalVideoTrack = null;
  // Restore local preview
  var localVid = $('gc-local-video');
  var localAv = $('gc-local-av');
  if (GC.callType === 'video' && GC.localStream) {
    if (localVid) { localVid.srcObject = GC.localStream; localVid.style.display = ''; }
    if (localAv) localAv.style.display = 'none';
  } else {
    if (localVid) localVid.style.display = 'none';
    if (localAv) localAv.style.display = '';
  }
  var btn = $('gc-screen-btn');
  if (btn) { btn.classList.remove('screen-active'); btn.innerHTML = '<i class="fa-solid fa-display"></i>'; }
}

function updateGroupCallParticipantCount() {
  var count = Object.keys(GC.peers).length + 1; // +1 for self
  var el = $('gc-participant-count');
  if (el) el.textContent = count + ' participant' + (count > 1 ? 's' : '');
  updateGcWaiting();
  updateGcGridLayout(count);
}

function updateGcGridLayout(count) {
  var grid = $('gc-video-grid');
  if (!grid) return;
  // Remove old size class
  grid.className = 'gc-video-grid';
  if (count <= 1) grid.classList.add('gc-1');
  else if (count === 2) grid.classList.add('gc-2');
  else if (count <= 4) grid.classList.add('gc-4');
  else if (count <= 6) grid.classList.add('gc-6');
  else grid.classList.add('gc-many');
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
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    subscribePush();
  } else if (Notification.permission === 'default') {
    // Show a prompt to the user on first interaction
    var asked = false;
    function askOnInteraction() {
      if (asked) return;
      asked = true;
      Notification.requestPermission().then(function (perm) {
        console.log('[Push] Permission result:', perm);
        if (perm === 'granted') subscribePush();
      });
      document.removeEventListener('click', askOnInteraction);
      document.removeEventListener('touchstart', askOnInteraction);
    }
    document.addEventListener('click', askOnInteraction, { once: true });
    document.addEventListener('touchstart', askOnInteraction, { once: true });
  }
}

// Web Push Subscription
function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  // Get VAPID public key from server
  api('/vapid_public_key/').then(function (data) {
    if (!data || !data.public_key) return;
    var vapidKey = urlBase64ToUint8Array(data.public_key);

    navigator.serviceWorker.ready.then(function (reg) {
      reg.pushManager.getSubscription().then(function (existing) {
        if (existing) {
          // Already subscribed, send to server in case user changed
          sendSubToServer(existing);
          return;
        }
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey
        }).then(function (sub) {
          sendSubToServer(sub);
        }).catch(function (err) {
          console.warn('[Push] Subscribe error:', err);
        });
      });
    });
  }).catch(function () { });
}

function sendSubToServer(sub) {
  var key = sub.getKey('p256dh');
  var auth = sub.getKey('auth');
  console.log('[Push] Sending subscription to server, endpoint:', sub.endpoint.substring(0, 60));
  api('/push_subscribe/', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(key))),
      auth: btoa(String.fromCharCode.apply(null, new Uint8Array(auth)))
    })
  }).catch(function () { });
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Add notification styles
var notifStyle = document.createElement('style');
notifStyle.textContent = '@keyframes slideInRight { from { transform: translateX(120%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(120%); opacity: 0; } } @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }';
document.head.appendChild(notifStyle);

// Initialize on load
requestNotificationPermission();

// Unlock audio playback on first user interaction (required by browsers)
(function unlockAudio() {
  var audioIds = ['ringtone', 'ringback', 'callend'];
  var unlocked = false;
  function doUnlock() {
    if (unlocked) return;
    unlocked = true;
    audioIds.forEach(function (id) {
      var el = $(id);
      if (el) {
        el.muted = true;
        el.play().then(function () { el.pause(); el.muted = false; el.currentTime = 0; })
          .catch(function () { el.muted = false; });
      }
    });
    // Also unlock msgSound
    if (typeof msgSound !== 'undefined') {
      msgSound.muted = true;
      msgSound.play().then(function () { msgSound.pause(); msgSound.muted = false; msgSound.currentTime = 0; })
        .catch(function () { msgSound.muted = false; });
    }
    document.removeEventListener('click', doUnlock, true);
    document.removeEventListener('touchstart', doUnlock, true);
    document.removeEventListener('keydown', doUnlock, true);
  }
  document.addEventListener('click', doUnlock, true);
  document.addEventListener('touchstart', doUnlock, true);
  document.addEventListener('keydown', doUnlock, true);
})();

init();
