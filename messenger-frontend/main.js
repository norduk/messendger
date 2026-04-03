const API_URL = '/api';
const SYNC_URL = '/sync-api';
let accessToken = sessionStorage.getItem('accessToken');
let syncToken = sessionStorage.getItem('syncToken');
let currentUser = null;
let socket = null;
let selectedFriendId = null;
let friends = [];
let messages = {};
let lastSyncTime = null;
let selectedMessages = new Set();
let isSelectionMode = false;
let deletedMessageIds = new Set();
let tokenRefreshInterval = null;
let notificationsEnabled = localStorage.getItem('notifications') !== 'false';
let soundEnabled = localStorage.getItem('sound') !== 'false';

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/['"<>&]/g, c => ({
    "'": '&#39;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;'
  })[c]);
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Браузер не поддерживает уведомления', 'error');
    return;
  }
  if (Notification.permission === 'granted') {
    showToast('Разрешение уже получено', 'info');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      showToast('Уведомления включены!', 'success');
      new Notification('SecureMessenger', { body: 'Уведомления работают!' });
    } else if (perm === 'denied') {
      showToast('Уведомления заблокированы', 'error');
    }
  });
}

function showNotification(title, body, icon, friendId) {
  if (!notificationsEnabled) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus() && selectedFriendId === friendId) return;
  
  try {
    const n = new Notification(title, {
      body: body,
      icon: icon || '/favicon.ico',
      tag: 'msg-' + friendId,
      renotify: true
    });
    
    n.onclick = () => {
      window.focus();
      selectChat(friendId);
      n.close();
    };
    
    setTimeout(() => n.close(), 5000);
  } catch (e) {
    console.warn('Notification error:', e);
  }
}

function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

function getStorageKey(userId) {
  return `messenger_messages_${userId}`;
}
function getSyncKeyKey(userId) {
  return `messenger_sync_key_${userId}`;
}
function getLastSyncKey(userId) {
  return `messenger_last_sync_${userId}`;
}
function getDeletedKey(userId) {
  return `messenger_deleted_${userId}`;
}

function loadMessagesFromStorage(userId) {
  try {
    const stored = localStorage.getItem(getStorageKey(userId));
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    return {};
  }
}

function saveMessagesToStorage(userId) {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(messages));
  } catch (e) {
    console.error('Failed to save messages:', e);
  }
}

function loadDeletedIds(userId) {
  try {
    const stored = localStorage.getItem(getDeletedKey(userId));
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch (e) {
    return new Set();
  }
}

function saveDeletedIds(userId) {
  try {
    localStorage.setItem(getDeletedKey(userId), JSON.stringify([...deletedMessageIds]));
  } catch (e) {
    console.error('Failed to save deleted ids:', e);
  }
}

function loadLastSyncTime(userId) {
  return localStorage.getItem(getLastSyncKey(userId));
}

function saveLastSyncTime(userId) {
  localStorage.setItem(getLastSyncKey(userId), Date.now().toString());
}

function startTokenRefresh() {
  if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
  
  tokenRefreshInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.accessToken) {
          accessToken = data.accessToken;
          sessionStorage.setItem('accessToken', accessToken);
          console.log('Token refreshed');
        }
      }
    } catch (e) {
      console.error('Token refresh failed:', e);
    }
  }, 12 * 60 * 60 * 1000);
}

function stopTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
  }
}

const api = {
  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    let response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include'
    });
    
    if (response.status === 401) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        response = await fetch(`${API_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include'
        });
      } else {
        logout();
        return { error: 'Session expired' };
      }
    }
    
    return response.json();
  },
  
  async refreshToken() {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      if (data.accessToken) {
        accessToken = data.accessToken;
        sessionStorage.setItem('accessToken', accessToken);
        return true;
      }
    } catch (e) {
      console.error('Refresh failed', e);
    }
    return false;
  },
  
  get: (endpoint) => api.request(endpoint),
  post: (endpoint, body) => api.request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => api.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (endpoint) => api.request(endpoint, { method: 'DELETE' })
};

const syncApi = {
  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (syncToken) {
      headers['Authorization'] = `Bearer ${syncToken}`;
    }
    
    const response = await fetch(`${SYNC_URL}${endpoint}`, {
      ...options,
      headers
    });
    
    return response.json();
  },
  
  async register(userId, password) {
    const response = await fetch(`${SYNC_URL}/api/sync/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password })
    });
    return response.json();
  },
  
  async login(userId, password) {
    const response = await fetch(`${SYNC_URL}/api/sync/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password })
    });
    return response.json();
  },
  
  async saveMessages(msgs) {
    return this.request('/api/sync/messages', {
      method: 'POST',
      body: JSON.stringify({ messages: msgs })
    });
  },
  
  async getMessages() {
    return this.request('/api/sync/messages');
  },
  
  async sync(localMessages, deletedIds = []) {
    return this.request('/api/sync/sync', {
      method: 'POST',
      body: JSON.stringify({
        messages: localMessages,
        lastSync: lastSyncTime,
        deletedIds
      })
    });
  }
};

async function initSync(password) {
  if (!currentUser || !password) return false;
  
  try {
    let result = await syncApi.login(currentUser.id, password);
    
    if (result.error === 'User not found') {
      result = await syncApi.register(currentUser.id, password);
    }
    
    if (result.token) {
      syncToken = result.token;
      sessionStorage.setItem('syncToken', syncToken);
      if (currentUser?.id) {
        localStorage.setItem(getSyncKeyKey(currentUser.id), password);
      }
      return true;
    }
  } catch (e) {
    console.error('Sync init failed:', e);
  }
  return false;
}

async function performSync() {
  if (!syncToken || !currentUser) return;
  
  try {
    const allMessages = Object.values(messages).flat();
    const result = await syncApi.sync(allMessages, [...deletedMessageIds]);
    
    if (result.deletedIds) {
      for (const id of result.deletedIds) {
        deletedMessageIds.add(id);
      }
      saveDeletedIds(currentUser.id);
    }
    
    if (result.messages) {
      const merged = {};
      for (const msg of result.messages) {
        if (deletedMessageIds.has(msg.id)) continue;
        
        const friendId = msg.sender_id === currentUser.id ? msg.recipient_id : msg.sender_id;
        if (!merged[friendId]) merged[friendId] = [];
        
        const exists = merged[friendId].find(m => m.id === msg.id);
        if (!exists) {
          merged[friendId].push(msg);
        }
      }
      
      for (const friendId of Object.keys(merged)) {
        merged[friendId].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      
      messages = merged;
      if (currentUser?.id) saveMessagesToStorage(currentUser.id);
      
      if (selectedFriendId) {
        renderMessages(selectedFriendId);
        renderFriends();
      }
    }
    
    lastSyncTime = Date.now().toString();
    if (currentUser?.id) saveLastSyncTime(currentUser.id);
  } catch (e) {
    console.error('Sync failed:', e);
  }
}

let syncInterval = null;

function startPeriodicSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(performSync, 600000);
}

function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function init() {
  setupAuthTabs();
  setupAuthForms();
  setupSearch();
  setupModals();
  setupMessageActions();
  setupMobileMenu();
  setupNewFeatures();
  
  if (accessToken) {
    loadUser();
  } else {
    showScreen('auth');
  }
}

function setupMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const mobileMenuBtnEmpty = document.getElementById('mobile-menu-btn-empty');
  
  let overlay = document.querySelector('.overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.getElementById('main-screen').appendChild(overlay);
  }
  
  if (window.innerWidth <= 768) {
    mobileMenuBtnEmpty.style.display = 'flex';
  }
  
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      mobileMenuBtnEmpty.style.display = 'flex';
    } else {
      mobileMenuBtnEmpty.style.display = 'none';
      sidebar.classList.remove('open');
      overlay.classList.remove('on');
    }
  });
  
  if (mobileMenuBtnEmpty) {
    mobileMenuBtnEmpty.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('on');
    });
  }
  
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('on');
  });
  
  setupSidebarResize();
}

function setupSidebarResize() {
  const sidebar = document.querySelector('.sidebar');
  const handle = document.getElementById('sidebar-resize');
  if (!handle || !sidebar) return;
  
  let startX, startWidth;
  
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  
  function onMouseMove(e) {
    const newWidth = startWidth + (e.clientX - startX);
    if (newWidth >= 180 && newWidth <= 500) {
      sidebar.style.width = newWidth + 'px';
    }
  }
  
  function onMouseUp() {
    handle.classList.remove('active');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

function setupAuthTabs() {
  document.querySelectorAll('.auth-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
    });
  });
}

function setupAuthForms() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  
  if (!loginForm || !registerForm) {
    console.error('Forms not found:', { loginForm, registerForm });
    return;
  }
  
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value;
    const password = document.getElementById('login-password').value;
    
    try {
      const data = await api.post('/auth/login', { name, password });
      if (data.accessToken) {
        accessToken = data.accessToken;
        sessionStorage.setItem('accessToken', accessToken);
        currentUser = data.user;
        showScreen('main');
        initApp();
        showToast('Добро пожаловать!', 'success');
      } else {
        showToast(data.error || 'Ошибка входа', 'error');
      }
    } catch (e) {
      showToast('Ошибка входа', 'error');
    }
  });
  
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('register-name').value;
    const password = document.getElementById('register-password').value;
    const inviteCode = document.getElementById('register-invite').value.toUpperCase();
    
    const btn = registerForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Регистрация...';
    }
    
    try {
      const data = await api.post('/auth/register', { password, displayName, inviteCode });
      console.log('Register response:', data);
      if (data.accessToken) {
        accessToken = data.accessToken;
        sessionStorage.setItem('accessToken', accessToken);
        currentUser = data.user;
        showScreen('main');
        initApp();
        showToast('Аккаунт создан!', 'success');
      } else {
        showToast(data.error || 'Ошибка регистрации', 'error');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Создать аккаунт';
        }
      }
    } catch (e) {
      console.error('Register error:', e);
      showToast('Ошибка регистрации', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Создать аккаунт';
      }
    }
  });
}

async function loadUser() {
  try {
    console.log('Loading user...');
    const data = await api.get('/auth/me');
    console.log('User data:', data);
    if (data.user) {
      currentUser = data.user;
      showScreen('main');
      console.log('Calling initApp...');
      initApp();
      console.log('App initialized');
    } else {
      console.log('No user, showing auth screen');
      sessionStorage.removeItem('accessToken');
      accessToken = null;
      showScreen('auth');
    }
  } catch (e) {
    console.error('Load user error:', e);
    showScreen('auth');
  }
}

async function initApp() {
  try {
    updateUserUI();
    loadFriends();
    setupSocket();
    setupChatTabs();
    setupUserAvatarClick();
    startTokenRefresh();
    requestNotificationPermission();
    initWebRTC();
    setupCallButtons();
    
    if (currentUser?.id) {
      messages = loadMessagesFromStorage(currentUser.id);
      deletedMessageIds = loadDeletedIds(currentUser.id);
      lastSyncTime = loadLastSyncTime(currentUser.id);
    }
    
    if (!syncToken) {
      try {
        await initSync('');
        await performSync();
        startPeriodicSync();
      } catch (syncError) {
        console.error('Sync init error (non-critical):', syncError);
      }
    } else {
      try {
        await performSync();
        startPeriodicSync();
      } catch (syncError) {
        console.error('Sync error (non-critical):', syncError);
      }
    }
  } catch (error) {
    console.error('Init app error:', error);
    showScreen('auth');
  }
}

function updateUserUI() {
  document.getElementById('current-user-name').textContent = currentUser.displayName || currentUser.email;
  const avatarEl = document.getElementById('current-user-avatar');
  if (currentUser.avatarUrl && currentUser.avatarUrl.startsWith('/uploads/')) {
    avatarEl.innerHTML = `<img src="${escapeAttr(currentUser.avatarUrl)}">`;
  } else {
    avatarEl.textContent = (currentUser.displayName || currentUser.email).charAt(0).toUpperCase();
  }
}

function setupUserAvatarClick() {
  document.querySelector('.user-info').addEventListener('click', () => {
    showMyProfile();
  });
}

function showMyProfile() {
  const isAvatarValid = currentUser.avatarUrl && currentUser.avatarUrl.startsWith('/uploads/');
  const displayName = escapeHtml(currentUser.displayName || 'Без имени');
  const nickname = currentUser.nickname ? escapeHtml(currentUser.nickname) : '';
  const email = currentUser.email ? escapeHtml(currentUser.email) : '';
  const phone = currentUser.phone ? escapeHtml(currentUser.phone) : '';
  
  document.getElementById('modal-title').textContent = 'Профиль';
  const modal = document.getElementById('modal-body');
  modal.innerHTML = `
    <div class="profile">
      <div class="profile-av" id="profile-avatar-container"></div>
      <div class="profile-name">${displayName}</div>
      ${nickname ? `<div class="profile-nick">@${nickname}</div>` : ''}
      <div class="profile-status on">● В сети</div>
      <div class="profile-card">
        <div class="profile-row">
          <span class="profile-lbl">ID</span>
          <span class="profile-val" style="cursor:pointer;font-family:var(--mn);font-size:11px" id="copy-id-btn">${nickname ? '@' + nickname : currentUser.id.substring(0,12) + '...'}</span>
        </div>
        ${email ? `<div class="profile-row"><span class="profile-lbl">Email</span><span class="profile-val">${email}</span></div>` : ''}
        ${phone ? `<div class="profile-row"><span class="profile-lbl">Телефон</span><span class="profile-val">${phone}</span></div>` : ''}
        ${currentUser.isAdmin ? `<div class="profile-row" style="margin-top:12px"><button class="btn btn-primary" id="open-admin-btn" style="width:100%">⚙️ Админ панель</button></div>` : ''}
      </div>
    </div>
  `;
  
  const avatarContainer = document.getElementById('profile-avatar-container');
  if (isAvatarValid) {
    avatarContainer.innerHTML = `<img src="${escapeAttr(currentUser.avatarUrl)}">`;
  } else {
    avatarContainer.textContent = (currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase();
  }
  
  document.getElementById('copy-id-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(nickname ? `@${currentUser.nickname}` : currentUser.id);
    showToast('ID скопирован', 'success');
  });
  
  const adminBtn = document.getElementById('open-admin-btn');
  if (adminBtn) {
    adminBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(`${API_URL}/users/admin-url`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await res.json();
        if (data.adminUrl) {
          window.open(data.adminUrl, '_blank');
        } else {
          showToast('Ошибка получения ссылки', 'error');
        }
      } catch (e) {
        showToast('Ошибка открытия админ панели', 'error');
      }
    });
  }
  
  document.querySelector('.modal').classList.add('active');
}

function setupSocket() {
  if (!accessToken) {
    console.log('No token, skipping socket connection');
    return;
  }
  
  try {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    
    socket = io(window.location.origin, {
      auth: { token: accessToken },
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
      timeout: 10000
    });
    
    socket.on('connect', () => {
      console.log('Socket connected');
    });
    
    socket.on('connect_error', (error) => {
      console.warn('Socket connection failed:', error.message);
      if (error.message === 'Authentication failed' || error.message === 'Authentication required') {
        socket.disconnect();
        socket = null;
      }
    });
    
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
    
    socket.on('message', (data) => {
      if (!messages[data.senderId]) messages[data.senderId] = [];
      messages[data.senderId].push({
        id: data.id,
        sender_id: data.senderId,
        recipient_id: currentUser?.id,
        encrypted_content: data.encryptedContent,
        content_type: data.contentType || 'text',
        file_url: data.fileUrl,
        file_name: data.fileName,
        file_size: data.fileSize,
        status: data.status || 'delivered',
        created_at: new Date().toISOString()
      });
      if (currentUser?.id) saveMessagesToStorage(currentUser.id);
      renderMessages(data.senderId);
      updateChatPreview(data.senderId);
      
      let content = data.encryptedContent;
      try { content = decodeURIComponent(escape(atob(data.encryptedContent))); } catch (e) {}
      if (data.contentType === 'image') content = '📷 Фото';
      if (data.contentType === 'file') content = '📎 ' + (data.fileName || 'Файл');
      
      const friend = friends.find(f => f.id === data.senderId);
      const senderName = friend?.display_name || friend?.email || 'Новое сообщение';
      const avatarUrl = friend?.avatarUrl && friend.avatarUrl.startsWith('/uploads/') ? friend.avatarUrl : null;
      
      showNotification(senderName, content, avatarUrl, data.senderId);
      playNotificationSound();
    });
    
    socket.on('typing', (data) => {
      showTypingIndicator(data.userId, data.userName);
    });
    
    socket.on('message_edited', (data) => {
      const msg = findMessage(data.id);
      if (msg) {
        msg.encrypted_content = data.encryptedContent;
        msg.edited_at = data.editedAt;
        if (selectedFriendId) renderMessages(selectedFriendId);
      }
    });
    
    socket.on('message_deleted', (data) => {
      const msg = findMessage(data.id);
      if (msg) {
        msg.is_deleted = true;
        if (selectedFriendId) renderMessages(selectedFriendId);
      }
    });
    
    socket.on('message_pinned', (data) => {
      const msg = findMessage(data.id);
      if (msg) {
        msg.isPinned = data.isPinned;
        msg.pinnedAt = data.pinnedAt;
        if (selectedFriendId) renderMessages(selectedFriendId);
      }
    });
    
    socket.on('reaction_added', (data) => {
      const msg = findMessage(data.messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = [];
        const existing = msg.reactions.find(r => r.emoji === data.emoji);
        if (existing) {
          existing.count++;
          if (!existing.users) existing.users = [];
          existing.users.push(data.userName);
        } else {
          msg.reactions.push({ emoji: data.emoji, count: 1, users: [data.userName] });
        }
        if (selectedFriendId) renderMessages(selectedFriendId);
      }
    });
    
    socket.on('reaction_removed', (data) => {
      const msg = findMessage(data.messageId);
      if (msg && msg.reactions) {
        const existing = msg.reactions.find(r => r.emoji === data.emoji);
        if (existing) {
          existing.count--;
          if (existing.count <= 0) {
            msg.reactions = msg.reactions.filter(r => r.emoji !== data.emoji);
          }
        }
        if (selectedFriendId) renderMessages(selectedFriendId);
      }
    });
    
    socket.on('message_status', (data) => {
      updateMessageStatus(data.messageId, data.status);
    });
  } catch (error) {
    console.error('Socket setup error:', error);
  }
}

function showScreen(screen) {
  const screenEl = document.getElementById(`${screen}-screen`);
  if (!screenEl) {
    console.error('Screen not found:', `${screen}-screen`);
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screenEl.classList.add('active');
  console.log('Screen changed to:', screen);
}

function setupChatTabs() {
  document.querySelectorAll('[data-chat-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-chat-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tab = btn.dataset.chatTab;
      document.getElementById('chats-list').style.display = tab === 'chats' ? 'block' : 'none';
      document.getElementById('requests-list').style.display = tab === 'requests' ? 'block' : 'none';
      
      if (tab === 'requests') loadRequests();
    });
  });
}

async function loadFriends() {
  try {
    const data = await api.get('/friends');
    friends = data.friends || [];
    renderFriends();
  } catch (e) {
    console.error('Failed to load friends', e);
  }
}

function renderFriends() {
  const list = document.getElementById('chats-list');
  
  if (friends.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--txF)"><p>Нет друзей</p><p style="font-size:12px;margin-top:8px">Добавьте друга чтобы начать общение</p></div>`;
    return;
  }
  
  list.innerHTML = '';
  
  friends.forEach(friend => {
    const div = document.createElement('div');
    div.className = `contact ${selectedFriendId === friend.id ? 'active' : ''}`;
    div.dataset.id = friend.id;
    
    const isAvatarValid = friend.avatarUrl && friend.avatarUrl.startsWith('/uploads/');
    const avatarHtml = isAvatarValid 
      ? `<img src="${escapeAttr(friend.avatarUrl)}">`
      : escapeHtml((friend.display_name || friend.email || 'U').charAt(0).toUpperCase());
    
    div.innerHTML = `
      <div class="av ${friend.status === 'online' ? 'online' : ''}">${avatarHtml}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(friend.display_name || friend.email)}</div>
        <div class="contact-preview">${escapeHtml(getLastMessagePreview(friend.id))}</div>
      </div>
      <div class="contact-meta">
        <span class="contact-time">${escapeHtml(formatTime(messages[friend.id]?.slice(-1)[0]?.createdAt))}</span>
        ${getUnreadCount(friend.id) > 0 ? `<span class="unread">${getUnreadCount(friend.id)}</span>` : ''}
      </div>
    `;
    
    div.addEventListener('click', () => selectChat(friend.id));
    list.appendChild(div);
  });
}

async function selectChat(friendId) {
  selectedFriendId = friendId;
  const friend = friends.find(f => f.id === friendId);
  
  document.querySelectorAll('.contact-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === friendId);
  });
  
  closeSettings();
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.overlay')?.classList.remove('on');
  
  if (!messages[friendId]) {
    const data = await api.get(`/messages/${friendId}?limit=50`);
    messages[friendId] = (data.messages || []).map(m => ({
      id: m.id,
      sender_id: m.senderId,
      recipient_id: m.recipientId,
      encrypted_content: m.encryptedContent,
      content_type: m.contentType,
      file_url: m.fileUrl,
      file_name: m.fileName,
      file_size: m.fileSize,
      status: m.status,
      created_at: m.createdAt
    }));
  }
  
  renderChatArea(friend);
  renderMessages(friendId);
  markMessagesAsRead(friendId);
}

function markMessagesAsRead(friendId) {
  const friendMessages = messages[friendId] || [];
  friendMessages.forEach(msg => {
    if (msg.recipient_id === currentUser?.id && msg.status !== 'read') {
      msg.status = 'read';
      socket.emit('read', { messageId: msg.id, senderId: friendId });
    }
  });
  renderFriends();
}

function renderChatArea(friend) {
  selectedMessages.clear();
  isSelectionMode = false;
  
  const isAvatarValid = friend.avatarUrl && friend.avatarUrl.startsWith('/uploads/');
  const avatarHtml = isAvatarValid
    ? `<img src="${escapeAttr(friend.avatarUrl)}" class="avatar-img" alt="Avatar">`
    : escapeHtml((friend.display_name || friend.email || 'U').charAt(0).toUpperCase());
  
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = `
    <div class="chat-hdr">
      <button class="back-btn" id="mobile-back-btn">◀</button>
      <div class="chat-hdr-info" id="chat-header-info" data-friend-id="${escapeAttr(friend.id)}">
        <div class="av sm ${friend.status === 'online' ? 'online' : ''}">${avatarHtml}</div>
        <div>
          <div class="user-name">${escapeHtml(friend.display_name || friend.email)}</div>
          <div class="user-status">${friend.status === 'online' ? 'В сети' : 'Не в сети'}</div>
        </div>
      </div>
      <div class="chat-hdr-actions">
        <button class="btn-icon" id="select-messages-btn" title="Выбрать">☑️</button>
        <button class="btn-icon" id="video-call-btn" title="Видеозвонок">📹</button>
        <button class="btn-icon" id="audio-call-btn" title="Аудиозвонок">📞</button>
      </div>
    </div>
    <div class="chat-area-inner">
      <div class="sel-bar" id="selection-bar" style="display: none;">
        <button class="btn-icon" id="cancel-selection-btn">✖️</button>
        <span id="selection-count">Выбрано: 0</span>
        <button class="btn btn-danger btn-sm" id="delete-selected-btn">Удалить</button>
      </div>
      <div class="messages" id="chat-messages"></div>
      <div class="typing" id="typing-indicator" style="display: none;"></div>
      <div class="input-bar">
        <div id="reply-preview"></div>
        <div class="input-wrap">
          <input type="file" id="file-input" class="file-input" accept="image/*,video/*,.pdf,.doc,.docx">
          <button class="attach-btn" id="attach-btn">📎</button>
          <button class="attach-btn" id="gif-btn">🎞️</button>
          <textarea class="msg-input" id="message-input" placeholder="Сообщение" rows="1"></textarea>
          <button class="send-btn" id="send-btn">➤</button>
        </div>
      </div>
    </div>
  `;
  
  setupMessageInput();
  setupSelectionMode();
  setupGifPicker();
  
  document.getElementById('chat-header-info').addEventListener('click', () => showFriendProfile(friend.id));
  
  document.getElementById('mobile-back-btn').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.add('open');
    document.querySelector('.overlay')?.classList.add('on');
  });
  
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

function setupSelectionMode() {
  document.getElementById('select-messages-btn').addEventListener('click', () => {
    isSelectionMode = true;
    selectedMessages.clear();
    document.getElementById('selection-bar').style.display = 'flex';
    document.getElementById('select-messages-btn').style.display = 'none';
    renderMessages(selectedFriendId);
  });
  
  document.getElementById('cancel-selection-btn').addEventListener('click', () => {
    isSelectionMode = false;
    selectedMessages.clear();
    document.getElementById('selection-bar').style.display = 'none';
    document.getElementById('select-messages-btn').style.display = '';
    renderMessages(selectedFriendId);
  });
  
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedMessages);
}

async function deleteSelectedMessages() {
  if (selectedMessages.size === 0) {
    showToast('Выберите сообщения для удаления', 'error');
    return;
  }
  
  if (!confirm(`Удалить ${selectedMessages.size} сообщений?`)) return;
  
  const messageIds = Array.from(selectedMessages);
  
  try {
    const result = await api.post('/messages/bulk-delete', { messageIds });
    if (result.deleted !== undefined) {
      messageIds.forEach(id => {
        messages[selectedFriendId] = messages[selectedFriendId].filter(m => m.id !== id);
        deletedMessageIds.add(id);
      });
      if (currentUser?.id) {
        saveMessagesToStorage(currentUser.id);
        saveDeletedIds(currentUser.id);
      }
      isSelectionMode = false;
      selectedMessages.clear();
      document.getElementById('selection-bar').style.display = 'none';
      document.getElementById('select-messages-btn').style.display = '';
      renderMessages(selectedFriendId);
      showToast(`Удалено ${result.deleted} сообщений`, 'success');
    } else {
      showToast(result.error || 'Ошибка удаления', 'error');
    }
  } catch (e) {
    showToast('Ошибка удаления', 'error');
  }
}

function setupMessageInput() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    
    if (selectedFriendId) {
      socket.emit('typing', { recipientId: selectedFriendId });
    }
  });
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  sendBtn.addEventListener('click', sendMessage);
  
  document.getElementById('attach-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  
  document.getElementById('file-input').addEventListener('change', handleFileUpload);
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  
  if (!content || !selectedFriendId) return;
  
  const editMsgId = input.dataset.editMsgId;
  if (editMsgId) {
    await editMessage(editMsgId, content);
    input.removeAttribute('data-edit-msg-id');
    return;
  }
  
  const tempId = Date.now();
  const encryptedContent = btoa(unescape(encodeURIComponent(content)));
  
  const messageData = {
    recipientId: selectedFriendId,
    encryptedContent,
    contentType: 'text',
    tempId,
    replyToId: replyingToMsg?.id || null
  };
  
  if (!messages[selectedFriendId]) messages[selectedFriendId] = [];
  
  messages[selectedFriendId].push({
    id: tempId,
    sender_id: currentUser.id,
    encrypted_content: encryptedContent,
    content_type: 'text',
    replyToId: replyingToMsg?.id || null,
    status: 'sent',
    created_at: new Date().toISOString(),
    temp: true
  });
  
  if (currentUser?.id) saveMessagesToStorage(currentUser.id);
  renderMessages(selectedFriendId);
  input.value = '';
  input.style.height = 'auto';
  
  if (replyingToMsg) {
    replyingToMsg = null;
    document.getElementById('reply-preview').style.display = 'none';
  }
  
  socket.emit('message', messageData);
  
  try {
    const result = await api.post(`/messages/${selectedFriendId}`, {
      encryptedContent,
      contentType: 'text',
      replyToId: replyingToMsg?.id || null
    });
    if (result.message) {
      const msgIndex = messages[selectedFriendId].findIndex(m => m.id === tempId);
      if (msgIndex !== -1) {
        messages[selectedFriendId][msgIndex].id = result.message.id;
        messages[selectedFriendId][msgIndex].temp = false;
        if (currentUser?.id) saveMessagesToStorage(currentUser.id);
      }
    }
  } catch (e) {
    console.error('Failed to save message', e);
  }
}

let replyingToMsg = null;

function renderMessages(friendId) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const friendMessages = messages[friendId] || [];
  container.innerHTML = '';
  
  friendMessages.forEach(msg => {
    if (msg.is_deleted && !msg.temp) return;
    
    const isSent = msg.sender_id === currentUser.id;
    let content = msg.encrypted_content;
    
    if (msg.content_type === 'text' || msg.content_type === 'gif') {
      try { content = decodeURIComponent(escape(atob(msg.encrypted_content))); } catch (e) { content = msg.encrypted_content; }
    }
    
    const fileUrl = msg.file_url || '';
    const fullUrl = fileUrl.startsWith('/') ? `${window.location.origin}/api${fileUrl}` : fileUrl;
    const isSelected = selectedMessages.has(msg.id);
    
    const div = document.createElement('div');
    div.className = `msg ${isSent ? 'mine' : 'other'} ${isSelected ? 'selected' : ''} ${msg.is_pinned ? 'pinned' : ''}`;
    div.dataset.id = msg.id;
    div.dataset.friendId = friendId;
    
    let inner = '';
    if (isSelectionMode && isSent) {
      inner += `<input type="checkbox" class="sel-cb" data-msg-id="${msg.id}" ${isSelected ? 'checked' : ''}>`;
    }
    
    if (!isSent) {
      const friend = friends.find(f => f.id === msg.sender_id);
      inner += `<div class="msg-head"><span class="msg-sender">${escapeHtml(friend?.display_name || friend?.email || 'User')}</span></div>`;
    }
    
    if (msg.replyToId && msg.replyContent) {
      const replyPreview = msg.reply_content_type === 'image' ? '📷 Фото' : (msg.reply_file_url ? '📎 Файл' : escapeHtml(msg.replyContent.substring(0, 50)));
      inner += `<div class="msg-reply-preview" data-reply-id="${msg.replyToId}"><span class="reply-label">Ответ ${escapeHtml(msg.replyUserName || 'User')}:</span><span class="reply-text">${replyPreview}</span></div>`;
    }
    
    if (msg.isPinned) {
      inner += `<div class="msg-pinned-badge">📌 Закреплено</div>`;
    }
    
    if (msg.content_type === 'text') inner += `<div class="msg-text" data-msg-id="${msg.id}">${escapeHtml(content)}</div>`;
    if (msg.content_type === 'gif' && fileUrl) inner += `<img src="${fileUrl}" class="msg-gif" alt="GIF" data-full-url="${escapeAttr(fileUrl)}">`;
    if (msg.content_type === 'image' && fileUrl) inner += `<img src="${fullUrl}" class="msg-img" alt="Image" data-full-url="${escapeAttr(fullUrl)}">`;
    if (msg.content_type === 'file' && fileUrl) inner += `<a href="${fullUrl}" target="_blank" class="msg-file">📄 ${escapeHtml(msg.file_name || 'Файл')}</a>`;
    
    if (msg.reactions && msg.reactions.length > 0) {
      inner += '<div class="msg-reactions">';
      msg.reactions.forEach(r => {
        inner += `<span class="reaction" data-emoji="${escapeAttr(r.emoji)}" data-msg-id="${msg.id}">${r.emoji} ${r.count}</span>`;
      });
      inner += '</div>';
    }
    
    if (msg.edited_at) {
      inner += `<span class="msg-edited">(ред.)</span>`;
    }
    
    inner += `<div class="msg-actions" data-msg-id="${msg.id}">
      <button class="msg-action-btn reply-btn" title="Ответить">↩️</button>
      <button class="msg-action-btn react-btn" title="Реакция">😊</button>
      <button class="msg-action-btn pin-btn" title="${msg.isPinned ? 'Открепить' : 'Закрепить'}">📌</button>
      ${isSent ? `<button class="msg-action-btn edit-btn" title="Редактировать">✏️</button>` : ''}
      ${isSent ? `<button class="msg-action-btn delete-btn" title="Удалить">🗑️</button>` : ''}
    </div>`;
    
    const checkMark = msg.status === 'read' ? '<span class="msg-check">✓✓</span>' : msg.status === 'delivered' ? '✓✓' : '✓';
    inner += `<div class="msg-head" style="justify-content:${isSent ? 'flex-end' : 'flex-start'}"><span class="msg-time">${formatTime(msg.created_at)}</span>${isSent ? `<span class="msg-status">${checkMark}</span>` : ''}</div>`;
    
    inner += '</div>';
    
    div.innerHTML = inner;
    container.appendChild(div);
  });
  
  container.scrollTop = container.scrollHeight;
}

function setupMessageActions() {
  document.addEventListener('click', (e) => {
    const replyBtn = e.target.closest('.reply-btn');
    if (replyBtn) {
      const msgId = replyBtn.closest('.msg-actions').dataset.msgId;
      const msg = findMessage(msgId);
      if (msg) {
        replyingToMsg = msg;
        showReplyPreview(msg);
      }
      return;
    }
    
    const reactBtn = e.target.closest('.react-btn');
    if (reactBtn) {
      const msgId = reactBtn.closest('.msg-actions').dataset.msgId;
      showEmojiPicker(msgId);
      return;
    }
    
    const pinBtn = e.target.closest('.pin-btn');
    if (pinBtn) {
      const msgId = pinBtn.closest('.msg-actions').dataset.msgId;
      const friendId = pinBtn.closest('.msg').dataset.friendId;
      togglePinMessage(msgId, friendId);
      return;
    }
    
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
      const msgId = editBtn.closest('.msg-actions').dataset.msgId;
      const msg = findMessage(msgId);
      if (msg) {
        startEditingMessage(msg);
      }
      return;
    }
    
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      const msgId = deleteBtn.closest('.msg-actions').dataset.msgId;
      const friendId = deleteBtn.closest('.msg').dataset.friendId;
      deleteMessage(msgId, friendId);
      return;
    }
    
    const reaction = e.target.closest('.reaction');
    if (reaction) {
      const msgId = reaction.dataset.msgId;
      const emoji = reaction.dataset.emoji;
      toggleReaction(msgId, emoji);
      return;
    }
    
    const replyPreview = e.target.closest('.msg-reply-preview');
    if (replyPreview) {
      const replyId = replyPreview.dataset.replyId;
      scrollToMessage(replyId);
      return;
    }
    
    const msgImg = e.target.closest('.msg-img, .msg-gif');
    if (msgImg && !isSelectionMode) {
      const fullUrl = msgImg.dataset.fullUrl;
      if (fullUrl) {
        showLightbox(fullUrl);
      }
      return;
    }
  });
  
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('msg-checkbox')) {
      const msgId = e.target.dataset.msgId;
      if (e.target.checked) {
        selectedMessages.add(msgId);
      } else {
        selectedMessages.delete(msgId);
      }
      document.getElementById('selection-count').textContent = `Выбрано: ${selectedMessages.size}`;
    }
  });
}

function findMessage(msgId) {
  for (const friendId in messages) {
    const msg = messages[friendId].find(m => m.id === msgId);
    if (msg) return msg;
  }
  return null;
}

function showReplyPreview(msg) {
  let previewText = msg.encrypted_content;
  try { previewText = decodeURIComponent(escape(atob(msg.encrypted_content))); } catch (e) {}
  previewText = previewText.substring(0, 40) + (previewText.length > 40 ? '...' : '');
  const replyPreview = document.getElementById('reply-preview');
  if (replyPreview) {
    replyPreview.innerHTML = `<span>Ответ: ${escapeHtml(msg.sender_id === currentUser.id ? 'Вы' : 'user')} - ${escapeHtml(previewText)}</span><button id="cancel-reply">✕</button>`;
    replyPreview.style.display = 'flex';
  }
  document.getElementById('cancel-reply')?.addEventListener('click', () => {
    replyingToMsg = null;
    document.getElementById('reply-preview').style.display = 'none';
  });
}

function showEmojiPicker(msgId) {
  const emojis = ['👍', '👎', '❤️', '😂', '😢', '😮', '😡', '🎉', '🔥', '👀'];
  let picker = document.getElementById('emoji-picker');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'emoji-picker';
    picker.className = 'emoji-picker';
    document.body.appendChild(picker);
  }
  picker.innerHTML = emojis.map(e => `<button class="emoji-btn" data-emoji="${e}">${e}</button>`).join('');
  picker.style.display = 'flex';
  picker.style.position = 'absolute';
  picker.dataset.msgId = msgId;
  const msgEl = document.querySelector(`.msg-actions[data-msg-id="${msgId}"]`);
  if (msgEl) {
    const rect = msgEl.getBoundingClientRect();
    picker.style.top = rect.bottom + 'px';
    picker.style.left = rect.left + 'px';
  }
  
  picker.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.onclick = () => {
      toggleReaction(msgId, btn.dataset.emoji);
      picker.style.display = 'none';
    };
  });
}

async function toggleReaction(msgId, emoji) {
  try {
    const msg = findMessage(msgId);
    const existing = msg?.reactions?.find(r => r.emoji === emoji);
    const action = existing ? 'remove' : 'add';
    
    await api.post(`/messages/${msgId}/reactions`, { emoji, action });
    
    if (msg) {
      if (!msg.reactions) msg.reactions = [];
      if (action === 'remove') {
        msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
      } else {
        msg.reactions.push({ emoji, count: 1, users: [currentUser.displayName] });
      }
      if (selectedFriendId) renderMessages(selectedFriendId);
    }
  } catch (e) {
    console.error('Reaction error:', e);
  }
}

async function togglePinMessage(msgId, friendId) {
  try {
    await api.put(`/messages/${msgId}/pin`);
    const msg = findMessage(msgId);
    if (msg) {
      msg.isPinned = !msg.isPinned;
      msg.pinnedAt = msg.isPinned ? new Date().toISOString() : null;
      renderMessages(friendId);
    }
  } catch (e) {
    console.error('Pin error:', e);
  }
}

function startEditingMessage(msg) {
  const input = document.getElementById('message-input');
  let content = msg.encrypted_content;
  try { content = decodeURIComponent(escape(atob(msg.encrypted_content))); } catch (e) {}
  input.value = content;
  input.dataset.editMsgId = msg.id;
  input.focus();
}

async function deleteMessage(msgId, friendId) {
  if (!confirm('Удалить сообщение?')) return;
  
  try {
    const result = await api.delete(`/messages/${msgId}`);
    if (result.message) {
      const msg = findMessage(msgId);
      if (msg) {
        msg.is_deleted = true;
      }
      if (selectedFriendId) renderMessages(selectedFriendId);
    }
  } catch (e) {
    console.error('Delete error:', e);
  }
}

async function editMessage(msgId, newContent) {
  try {
    const encrypted = btoa(unescape(encodeURIComponent(newContent)));
    await api.put(`/messages/${msgId}`, { encryptedContent: encrypted });
    const msg = findMessage(msgId);
    if (msg) {
      msg.encrypted_content = encrypted;
      msg.edited_at = new Date().toISOString();
      renderMessages(selectedFriendId);
    }
    document.getElementById('message-input').removeAttribute('data-edit-msg-id');
  } catch (e) {
    console.error('Edit error:', e);
  }
}

function scrollToMessage(msgId) {
  const el = document.querySelector(`.msg[data-id="${msgId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight');
    setTimeout(() => el.classList.remove('highlight'), 2000);
  }
}

function showLightbox(url) {
  let lightbox = document.getElementById('lightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightbox';
    lightbox.innerHTML = '<img id="lightbox-img"><button id="lightbox-close">✕</button>';
    document.body.appendChild(lightbox);
  }
  document.getElementById('lightbox-img').src = url;
  lightbox.style.display = 'flex';
  document.getElementById('lightbox-close').onclick = () => lightbox.style.display = 'none';
  lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.style.display = 'none'; };
}

function showSearch() {
  document.getElementById('search-modal').classList.add('active');
}

async function searchMessages(query) {
  if (!query) return;
  try {
    const result = await api.get(`/messages/search?q=${encodeURIComponent(query)}`);
    document.getElementById('search-results').innerHTML = result.messages.map(m => {
      let content = m.encryptedContent;
      try { content = decodeURIComponent(escape(atob(m.encryptedContent))); } catch (e) {}
      return `<div class="search-result" data-msg-id="${m.id}">
        <div class="search-result-head">${escapeHtml(m.senderName)} - ${formatTime(m.createdAt)}</div>
        <div class="search-result-text">${escapeHtml(content.substring(0, 100))}</div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('Search error:', e);
  }
}

function updateMessageStatus(tempId, status) {
  const msgEl = document.querySelector(`[data-id="${tempId}"]`);
  if (msgEl) {
    const statusEl = msgEl.querySelector('.message-status');
    if (statusEl) {
      statusEl.textContent = getStatusIcon(status);
    }
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓';
    default: return '';
  }
}

function showTypingIndicator(userId, userName) {
  const indicator = document.getElementById('typing-indicator');
  const friend = friends.find(f => f.id === userId);
  const name = userName || friend?.display_name || friend?.email || 'User';
  if (indicator) {
    indicator.textContent = `${name} печатает...`;
    indicator.style.display = 'block';
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
      indicator.style.display = 'none';
    }, 2000);
  }
}

function setupNewFeatures() {
  document.getElementById('search-close-btn')?.addEventListener('click', () => {
    document.getElementById('search-modal').classList.remove('active');
  });
  
  document.getElementById('search-messages-input')?.addEventListener('input', (e) => {
    searchMessages(e.target.value);
  });
  
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('emoji-picker');
    if (picker && !e.target.closest('.emoji-picker') && !e.target.closest('.react-btn')) {
      picker.style.display = 'none';
    }
  });
  
  document.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const msgId = el.dataset.msgId;
      const friendId = selectedFriendId;
      if (friendId) {
        document.getElementById('search-modal').classList.remove('active');
        openChat(friendId);
        setTimeout(() => scrollToMessage(msgId), 300);
      }
    });
  });
}

function setupGifPicker() {
  const modal = document.getElementById('gif-picker-modal');
  document.getElementById('gif-btn')?.addEventListener('click', () => {
    modal.classList.add('active');
    searchGifs('');
  });
  
  document.getElementById('gif-close-btn')?.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  document.getElementById('gif-search-input')?.addEventListener('input', (e) => {
    searchGifs(e.target.value);
  });
}

async function searchGifs(query) {
  const container = document.getElementById('gif-results');
  if (!query) {
    query = 'funny';
  }
  
  try {
    const response = await fetch(`${API_URL}/gif/search?q=${encodeURIComponent(query)}&limit=20`);
    const data = await response.json();
    container.innerHTML = data.results?.map(gif => 
      `<img src="${gif.media_formats?.tinygif?.url}" data-gif-url="${gif.media_formats?.gif?.url}" data-preview="${gif.media_formats?.tinygif?.url}">`
    ).join('') || '<p style="color:var(--txF)">GIF не найдены</p>';
    
    container.querySelectorAll('img').forEach(img => {
      img.onclick = () => sendGif(img.dataset.gifUrl);
    });
  } catch (e) {
    container.innerHTML = '<p style="color:var(--txF)">Ошибка загрузки GIF</p>';
  }
}

async function sendGif(gifUrl) {
  if (!selectedFriendId) return;
  
  const tempId = Date.now();
  const messageData = {
    recipientId: selectedFriendId,
    encryptedContent: btoa(unescape(encodeURIComponent('GIF'))),
    contentType: 'gif',
    tempId,
    fileUrl: gifUrl
  };
  
  if (!messages[selectedFriendId]) messages[selectedFriendId] = [];
  
  messages[selectedFriendId].push({
    id: tempId,
    sender_id: currentUser.id,
    encrypted_content: btoa(unescape(encodeURIComponent('GIF'))),
    content_type: 'gif',
    file_url: gifUrl,
    status: 'sent',
    created_at: new Date().toISOString(),
    temp: true
  });
  
  renderMessages(selectedFriendId);
  document.getElementById('gif-picker-modal').classList.remove('active');
  socket.emit('message', messageData);
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch(`${API_URL}/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: formData
    });
    
    const data = await response.json();
    if (data.file) {
      const contentType = file.type.startsWith('image/') ? 'image' : 
                          file.type.startsWith('video/') ? 'video' : 'file';
      
      const encryptedContent = btoa(JSON.stringify({ fileName: data.file.originalName }));
      
      await api.post(`/messages/${selectedFriendId}`, {
        encryptedContent,
        contentType,
        fileUrl: data.file.url,
        fileName: data.file.originalName,
        fileSize: data.file.size
      });
      
      socket.emit('message', {
        recipientId: selectedFriendId,
        encryptedContent,
        contentType,
        fileUrl: data.file.url,
        fileName: data.file.originalName
      });
      
      if (!messages[selectedFriendId]) messages[selectedFriendId] = [];
      messages[selectedFriendId].push({
        sender_id: currentUser.id,
        encrypted_content: encryptedContent,
        content_type: contentType,
        file_url: data.file.url,
        file_name: data.file.originalName,
        created_at: new Date().toISOString()
      });
      
      if (currentUser?.id) saveMessagesToStorage(currentUser.id);
      renderMessages(selectedFriendId);
    }
  } catch (e) {
    showToast('Ошибка загрузки файла', 'error');
  }
}

async function loadRequests() {
  try {
    const data = await api.get('/friends/requests');
    renderRequests(data.incoming || []);
  } catch (e) {
    console.error('Failed to load requests', e);
  }
}

function renderRequests(requests) {
  const list = document.getElementById('requests-list');
  
  if (requests.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <p>Нет запросов</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = '';
  
  requests.forEach(req => {
    const div = document.createElement('div');
    div.className = 'request-item';
    div.innerHTML = `
      <div class="avatar small">${escapeHtml((req.display_name || req.email || 'U').charAt(0).toUpperCase())}</div>
      <div class="request-info">
        <div class="contact-name">${escapeHtml(req.display_name || req.email)}</div>
        <div class="contact-preview">${escapeHtml(req.email)}</div>
      </div>
      <div class="request-actions">
        <button class="btn btn-accept" data-id="${escapeAttr(req.id)}">Принять</button>
        <button class="btn btn-decline" data-id="${escapeAttr(req.id)}">Отклонить</button>
      </div>
    `;
    
    div.querySelector('.btn-accept').addEventListener('click', () => handleRequest(req.id, 'accept'));
    div.querySelector('.btn-decline').addEventListener('click', () => handleRequest(req.id, 'decline'));
    
    list.appendChild(div);
  });
}

async function handleRequest(id, action) {
  try {
    await api.put(`/friends/request/${id}`, { action });
    showToast(action === 'accept' ? 'Запрос принят' : 'Запрос отклонён', 'success');
    loadRequests();
    loadFriends();
  } catch (e) {
    showToast('Ошибка обработки запроса', 'error');
  }
}

function setupSearch() {
  const searchInput = document.getElementById('search-input');
  let searchTimeout;
  
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (query.length >= 2) {
        const data = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
        if (data.users) {
          showSearchResults(data.users);
        }
      }
    }, 300);
  });
  
  document.getElementById('add-friend-btn').addEventListener('click', () => {
    showModal('Добавить друга', `
      <form id="add-friend-form" style="display: flex; gap: 12px; align-items: center;">
        <input type="text" id="friend-identifier" placeholder="ID, email или имя" style="flex: 1;">
        <button type="submit" class="btn btn-primary" id="send-request-btn" style="padding: 10px 20px; width: auto;">Добавить</button>
      </form>
      <div id="request-status" style="margin-top: 12px; text-align: center;"></div>
    `);
    
    document.getElementById('friend-identifier').focus();
    
    document.getElementById('add-friend-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('friend-identifier').value.trim();
      const statusEl = document.getElementById('request-status');
      const btn = document.getElementById('send-request-btn');
      
      if (!identifier) {
        statusEl.innerHTML = '<span style="color: var(--error); font-size: 13px;">Введите ID, email или имя</span>';
        return;
      }
      
      btn.disabled = true;
      btn.textContent = '...';
      statusEl.innerHTML = '';
      
      try {
        const response = await fetch('/api/friends/request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ identifier })
        });
        
        const data = await response.json();
        
        if (response.ok && (data.friendship || data.message)) {
          statusEl.innerHTML = `<span style="color: var(--success); font-size: 13px;">
            ${data.message || (data.foundUser ? `Запрос отправлен ${data.foundUser.displayName || data.foundUser.email}!` : 'Запрос отправлен!')}
          </span>`;
          setTimeout(closeModal, 1500);
          loadFriends();
          loadRequests();
        } else {
          statusEl.innerHTML = `<span style="color: var(--error); font-size: 13px;">${data.error || 'Ошибка отправки'}</span>`;
        }
      } catch (e) {
        statusEl.innerHTML = '<span style="color: var(--error);">Ошибка сети. Попробуйте снова.</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Отправить';
      }
    });
  });
}

function showSearchResults(users) {
  const existing = document.querySelector('.search-results');
  if (existing) existing.remove();
  
  if (users.length === 0) return;
  
  const container = document.createElement('div');
  container.className = 'search-results';
  container.style.cssText = `
    position: absolute;
    top: 100%;
    left: 16px;
    right: 16px;
    background: var(--surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow);
    max-height: 300px;
    overflow-y: auto;
    z-index: 100;
  `;
  
  container.innerHTML = '';
  
  users.forEach(user => {
    const div = document.createElement('div');
    div.className = 'contact-item';
    div.dataset.identifier = user.id;
    div.innerHTML = `
      <div class="avatar small">${escapeHtml((user.displayName || user.name || 'U').charAt(0).toUpperCase())}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(user.displayName || user.name || 'Unknown')}</div>
        <div class="contact-preview" style="font-size: 10px; opacity: 0.7;">ID: ${escapeHtml(user.id?.substring(0, 8))}...</div>
      </div>
    `;
    container.appendChild(div);
  });
  
  container.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', async () => {
      const identifier = item.dataset.identifier;
      item.style.opacity = '0.5';
      item.style.pointerEvents = 'none';
      
      try {
        const response = await fetch('/api/friends/request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ identifier })
        });
        
        const data = await response.json();
        
        if (response.ok && (data.friendship || data.message)) {
          const name = data.foundUser?.displayName || data.foundUser?.email || 'Пользователь';
          showToast(`Запрос отправлен ${name}!`, 'success');
          container.remove();
          loadFriends();
          loadRequests();
        } else {
          showToast(data.error || 'Ошибка отправки', 'error');
          item.style.opacity = '1';
          item.style.pointerEvents = 'auto';
        }
      } catch (e) {
        showToast('Ошибка сети', 'error');
        item.style.opacity = '1';
        item.style.pointerEvents = 'auto';
      }
    });
  });
}

function setupModals() {
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.querySelector('.modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) closeModal();
  });
  
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-back-btn').addEventListener('click', closeSettings);
  
  document.querySelectorAll('.settings-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSettingsTab(btn.dataset.settingsTab);
    });
  });
}

function openSettings() {
  document.querySelector('.chat-area').style.display = 'none';
  document.getElementById('settings-panel').classList.add('active');
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.overlay')?.classList.remove('on');
  
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
  document.querySelector('.settings-tab[data-settings-tab="profile"]').classList.add('active');
  renderSettingsTab('profile');
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('active');
  document.querySelector('.chat-area').style.display = '';
}

function renderSettingsTab(tab) {
  const content = document.getElementById('settings-content');
  
  if (tab === 'profile') {
    renderProfileView(content);
  } else if (tab === 'account') {
    renderAccountView(content);
  }
}

function renderProfileView(container) {
  const isOnline = true;
  
  container.innerHTML = `
    <div id="profile-view-mode">
      <div class="settings-av">
        <div class="settings-av-wrap">
          <div class="settings-av-preview" id="profile-avatar-display">
            ${currentUser.avatarUrl ? `<img src="${escapeAttr(currentUser.avatarUrl)}">` : escapeHtml((currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase())}
          </div>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:16px">
        <div class="profile-name">${escapeHtml(currentUser.displayName || 'Без имени')}</div>
        ${currentUser.nickname ? `<div class="profile-nick">@${escapeHtml(currentUser.nickname)}</div>` : ''}
        <div class="profile-status ${isOnline ? 'on' : ''}">${isOnline ? '● В сети' : '○ Не в сети'}</div>
      </div>
      
      <div class="profile-card">
        <div class="profile-row">
          <span class="profile-lbl">ID</span>
          <span class="profile-val" style="cursor:pointer;font-family:var(--mn);font-size:11px" onclick="navigator.clipboard.writeText('${escapeAttr(currentUser.nickname ? '@' + currentUser.nickname : currentUser.id)}'); showToast('ID скопирован', 'success')">${escapeHtml(currentUser.nickname ? '@' + currentUser.nickname : currentUser.id.substring(0,12) + '...')}</span>
        </div>
        ${currentUser.email ? `<div class="profile-row"><span class="profile-lbl">Email</span><span class="profile-val">${escapeHtml(currentUser.email)}</span></div>` : ''}
        ${currentUser.phone ? `<div class="profile-row"><span class="profile-lbl">Телефон</span><span class="profile-val">${escapeHtml(currentUser.phone)}</span></div>` : ''}
      </div>
      
      <button class="btn btn-primary" id="edit-profile-btn" style="width:100%;margin-top:16px">Редактировать профиль</button>
    </div>
    
    <div id="profile-edit-mode" style="display:none">
      <div class="edit-row">
        <div class="edit-row-av" id="edit-avatar-preview">
          ${currentUser.avatarUrl ? `<img src="${escapeAttr(currentUser.avatarUrl)}">` : escapeHtml((currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase())}
        </div>
        <div class="edit-row-info">
          <p>Аватарка (макс. 5 МБ)</p>
          <input type="file" id="edit-avatar-input" class="file-input" accept="image/*">
          <button class="btn btn-secondary btn-sm" id="edit-avatar-btn">Изменить</button>
        </div>
      </div>
      
      <div class="settings-field"><label>Имя</label><input type="text" id="edit-name" value="${escapeAttr(currentUser.displayName || '')}" placeholder="Ваше имя"></div>
      <div class="settings-field"><label>Никнейм</label><input type="text" id="edit-nickname" value="${escapeAttr(currentUser.nickname || '')}" placeholder="myname"><small style="color:var(--txF);font-size:11px">Латиница, цифры и _</small></div>
      <div class="settings-field"><label>Email</label><input type="email" id="edit-email" value="${escapeAttr(currentUser.email || '')}" placeholder="example@mail.com"></div>
      <div class="settings-field"><label>Телефон</label><input type="tel" id="edit-phone" value="${escapeAttr(currentUser.phone || '')}" placeholder="+7 (___) ___-__-__"></div>
      
      <div class="settings-section" style="margin-top:16px;border-top:1px solid var(--bd);padding-top:16px">
        <h3>Смена пароля</h3>
        <div class="settings-field"><label>Текущий пароль</label><input type="password" id="edit-current-password" placeholder="Введите текущий пароль"></div>
        <div class="settings-field"><label>Новый пароль</label><input type="password" id="edit-new-password" placeholder="Минимум 8 символов" minlength="8"></div>
        <div class="settings-field"><label>Подтвердите пароль</label><input type="password" id="edit-confirm-password" placeholder="Повторите новый пароль"></div>
      </div>
      
      <div class="settings-actions">
        <button class="btn btn-ghost" id="cancel-edit-btn">Отмена</button>
        <button class="btn btn-primary" id="save-profile-btn">Сохранить</button>
      </div>
    </div>
    
    <div class="logout-section">
      <button class="btn btn-logout" id="settings-logout-btn">Выйти из аккаунта</button>
    </div>
  `;
  
  document.getElementById('edit-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = 'none';
    document.getElementById('profile-edit-mode').style.display = '';
  });
  
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = '';
    document.getElementById('profile-edit-mode').style.display = 'none';
  });
  
  document.getElementById('edit-avatar-btn').addEventListener('click', () => {
    document.getElementById('edit-avatar-input').click();
  });
  
  document.getElementById('edit-avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      showToast('Файл слишком большой (макс. 5 МБ)', 'error');
      return;
    }
    
    const formData = new FormData();
    formData.append('avatar', file);
    
    const btn = document.getElementById('edit-avatar-btn');
    btn.disabled = true;
    btn.textContent = 'Загрузка...';
    
    try {
      const response = await fetch(`${API_URL}/users/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: formData
      });
      
      const data = await response.json();
      if (data.user) {
        currentUser.avatarUrl = data.user.avatarUrl;
        updateUserUI();
        
        const preview = document.getElementById('edit-avatar-preview');
        preview.innerHTML = `<img src="${data.user.avatarUrl}" class="avatar-img" alt="Avatar">`;
        
        showToast('Аватар обновлён', 'success');
      } else {
        showToast(data.error || 'Ошибка загрузки', 'error');
      }
    } catch (e) {
      showToast('Ошибка загрузки аватара', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Изменить аватар';
    }
  });
  
  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const displayName = document.getElementById('edit-name').value;
    const nickname = document.getElementById('edit-nickname').value.replace(/[^a-zA-Z0-9_]/g, '');
    const email = document.getElementById('edit-email').value;
    const phone = document.getElementById('edit-phone').value;
    
    const currentPassword = document.getElementById('edit-current-password').value;
    const newPassword = document.getElementById('edit-new-password').value;
    const confirmPassword = document.getElementById('edit-confirm-password').value;
    
    if (currentPassword || newPassword || confirmPassword) {
      if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('Заполните все поля для смены пароля', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('Пароли не совпадают', 'error');
        return;
      }
      if (newPassword.length < 8) {
        showToast('Пароль должен быть минимум 8 символов', 'error');
        return;
      }
      
      try {
        await api.put('/users/password', { currentPassword, newPassword });
        showToast('Пароль изменён', 'success');
      } catch (e) {
        showToast(e.message || 'Ошибка смены пароля', 'error');
        return;
      }
    }
    
    try {
      await api.put('/users/profile', { displayName, nickname, email, phone });
      currentUser.displayName = displayName;
      currentUser.nickname = nickname;
      currentUser.email = email;
      currentUser.phone = phone;
      updateUserUI();
      showToast('Профиль сохранён', 'success');
      renderProfileView(container);
    } catch (e) {
      showToast(e.message || 'Ошибка сохранения', 'error');
    }
  });
  
  document.getElementById('settings-logout-btn').addEventListener('click', () => {
    closeSettings();
    logout();
  });
}

function renderAccountView(container) {
  const lastSync = lastSyncTime ? new Date(parseInt(lastSyncTime)).toLocaleString() : 'Никогда';
  const notifPerm = 'Notification' in window ? Notification.permission : 'unsupported';
  
  container.innerHTML = `
    <div class="settings-section">
      <h3>Уведомления</h3>
      <div class="profile-card">
        <div class="profile-row">
          <span class="profile-lbl">Push-уведомления</span>
          <button class="tgl ${notificationsEnabled ? 'on' : ''}" id="notif-toggle"></button>
        </div>
        <div class="profile-row">
          <span class="profile-lbl">Звук уведомлений</span>
          <button class="tgl ${soundEnabled ? 'on' : ''}" id="sound-toggle"></button>
        </div>
        ${notifPerm === 'default' ? `<div class="profile-row"><span class="profile-lbl">Разрешение</span><button class="btn btn-secondary btn-sm" id="notif-perm-btn">Разрешить</button></div>` : ''}
        ${notifPerm === 'denied' ? `<div class="profile-row"><span class="profile-lbl">Разрешение</span><span style="color:var(--rd);font-size:12px">Заблокировано в браузере</span></div>` : ''}
      </div>
    </div>
    <div class="settings-section">
      <h3>Синхронизация</h3>
      <div class="profile-card">
        <div class="profile-row"><span class="profile-lbl">Статус</span><span class="profile-val" style="color:var(--gr)">Автоматически каждые 10 мин.</span></div>
        <div class="profile-row"><span class="profile-lbl">Последняя синхр.</span><span class="profile-val">${escapeHtml(lastSync)}</span></div>
      </div>
    </div>
  `;
  
  document.getElementById('notif-toggle')?.addEventListener('click', toggleNotifications);
  document.getElementById('sound-toggle')?.addEventListener('click', toggleSound);
  document.getElementById('notif-perm-btn')?.addEventListener('click', () => {
    requestNotificationPermission();
    setTimeout(() => renderSettingsTab('account'), 500);
  });
}

function toggleNotifications() {
  notificationsEnabled = !notificationsEnabled;
  localStorage.setItem('notifications', notificationsEnabled);
  const btn = document.getElementById('notif-toggle');
  btn.classList.toggle('on', notificationsEnabled);
  if (notificationsEnabled) requestNotificationPermission();
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('sound', soundEnabled);
  const btn = document.getElementById('sound-toggle');
  btn.classList.toggle('on', soundEnabled);
}

function showModal(title, content) {
  document.getElementById('modal-body').innerHTML = `
    <h2>${title}</h2>
    ${content}
  `;
  document.querySelector('.modal').classList.add('active');
}

function closeModal() {
  document.querySelector('.modal').classList.remove('active');
}

function logout() {
  stopPeriodicSync();
  stopTokenRefresh();
  accessToken = null;
  syncToken = null;
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem('syncToken');
  if (socket) socket.disconnect();
  if (currentUser?.id) {
    localStorage.removeItem(getStorageKey(currentUser.id));
    localStorage.removeItem(getLastSyncKey(currentUser.id));
  }
  currentUser = null;
  friends = [];
  messages = {};
  selectedFriendId = null;
  showScreen('auth');
  showToast('Вы вышли', 'success');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  
  if (diff < 60000) return 'сейчас';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'м';
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getLastMessagePreview(friendId) {
  const msgs = messages[friendId];
  if (!msgs || msgs.length === 0) return 'Нет сообщений';
  const last = msgs[msgs.length - 1];
  if (last.content_type === 'image') return '🖼 Фото';
  if (last.content_type === 'video') return '🎥 Видео';
  if (last.content_type === 'file') return '📄 Файл';
  try {
    return decodeURIComponent(escape(atob(last.encrypted_content))).substring(0, 30);
  } catch {
    return 'Сообщение';
  }
}

function getUnreadCount(friendId) {
  return (messages[friendId] || []).filter(m => 
    m.recipient_id === currentUser?.id && m.status !== 'read'
  ).length;
}

async function showFriendProfile(friendId) {
  const friend = friends.find(f => f.id === friendId);
  if (!friend) return;
  
  let isOnline = false;
  let lastSeen = null;
  let nickname = null;
  
  try {
    const statusData = await api.get(`/users/online-status/${friendId}`);
    isOnline = statusData.online;
    const userData = await api.get(`/users/${friendId}`);
    if (userData.user?.lastSeen) lastSeen = userData.user.lastSeen;
    if (userData.user?.nickname) nickname = userData.user.nickname;
  } catch (e) {
    console.error('Failed to get online status:', e);
  }
  
  const lastSeenText = isOnline ? 'В сети' : (lastSeen ? formatLastSeen(lastSeen) : 'Недавно');
  const displayName = escapeHtml(friend.display_name || friend.email);
  const email = friend.email ? escapeHtml(friend.email) : '';
  const isAvatarValid = friend.avatarUrl && friend.avatarUrl.startsWith('/uploads/');
  
  document.getElementById('modal-title').textContent = 'Профиль';
  const modal = document.getElementById('modal-body');
  modal.innerHTML = `
    <div class="profile">
      <div class="profile-av" id="friend-avatar-container"></div>
      <div class="profile-name">${displayName}</div>
      ${nickname ? `<div class="profile-nick">@${escapeHtml(nickname)}</div>` : ''}
      <div class="profile-status ${isOnline ? 'on' : ''}">${isOnline ? '● В сети' : '○ Не в сети'}</div>
      <div class="profile-card">
        <div class="profile-row">
          <span class="profile-lbl">ID</span>
          <span class="profile-val" style="cursor:pointer;font-family:var(--mn);font-size:11px" id="friend-copy-id-btn">${nickname ? '@' + escapeHtml(nickname) : friend.id.substring(0,12) + '...'}</span>
        </div>
        ${email ? `<div class="profile-row"><span class="profile-lbl">Email</span><span class="profile-val">${email}</span></div>` : ''}
        <div class="profile-row"><span class="profile-lbl">Последний онлайн</span><span class="profile-val">${escapeHtml(lastSeenText)}</span></div>
      </div>
    </div>
  `;
  
  const avatarContainer = document.getElementById('friend-avatar-container');
  if (isAvatarValid) {
    avatarContainer.innerHTML = `<img src="${escapeAttr(friend.avatarUrl)}">`;
  } else {
    avatarContainer.textContent = (friend.display_name || friend.email || 'U').charAt(0).toUpperCase();
  }
  
  document.getElementById('friend-copy-id-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(nickname ? `@${nickname}` : friend.id);
    showToast('ID скопирован', 'success');
  });
  
  document.querySelector('.modal').classList.add('active');
}

function formatLastSeen(date) {
  if (!date) return 'Недавно';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  
  if (diff < 60000) return 'Только что';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин. назад';
  if (diff < 86400000) return 'Сегодня в ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 172800000) return 'Вчера в ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateChatPreview(friendId) {
  const item = document.querySelector(`.contact-item[data-id="${friendId}"]`);
  if (item) {
    const preview = item.querySelector('.contact-preview');
    const time = item.querySelector('.contact-time');
    preview.textContent = getLastMessagePreview(friendId);
    time.textContent = formatTime(messages[friendId]?.slice(-1)[0]?.createdAt);
  }
}

let isInCall = false;
let callSound = null;

const RtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

class CallManager {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.isInitiator = false;
    this.targetUserId = null;
    this.callType = null;
    this.roomId = null;
  }

  async initLocalStream(type) {
    try {
      const constraints = { audio: true, video: type === 'video' };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      console.warn('No camera, trying audio only:', e);
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    return this.localStream;
  }

  createPeerConnection() {
    if (this.pc) {
      this.pc.close();
    }

    console.log('Creating RTCPeerConnection');
    this.pc = new RTCPeerConnection(RtcConfig);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.localStream);
      });
    }

    this.pc.ontrack = (event) => {
      console.log('ontrack received:', event.streams[0], 'kind:', event.track.kind);
      this.remoteStream = event.streams[0];
      this.updateRemoteVideo();
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        SignalingClient.sendIceCandidate(this.targetUserId, event.candidate);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === 'connected') {
        CallUI.setConnected();
      }
    };

    return this.pc;
  }

  async createOffer() {
    const pc = this.createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp) {
    const pc = this.createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp) {
    if (!this.pc) {
      console.error('No peerConnection to handle answer');
      return;
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
  }

  async addIceCandidate(candidate) {
    if (!this.pc) {
      console.warn('No peerConnection for ICE candidate');
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  }

  updateRemoteVideo() {
    let remoteVideo = document.getElementById('remote-video');
    if (!remoteVideo) {
      CallUI.show('connected');
      remoteVideo = document.getElementById('remote-video');
    }
    if (remoteVideo && this.remoteStream) {
      remoteVideo.srcObject = this.remoteStream;
    }
  }

  close() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream = null;
  }
}

const callManager = new CallManager();

const SignalingClient = {
  setup() {
    socket.on('incoming-call', (data) => {
      console.log('incoming-call:', data);
      playCallSound('ringing');
      CallUI.showIncoming(data);
    });

    socket.on('call-accepted', async (data) => {
      console.log('call-accepted:', data);
      playCallSound(null);
      callManager.roomId = data.RoomID;
      callManager.targetUserId = data.SenderID;
      const offer = await callManager.createOffer();
      socket.emit('offer', {
        targetId: data.SenderID,
        roomId: data.RoomID,
        sdp: offer.sdp
      });
      CallUI.show('connected');
    });

    socket.on('offer', async (data) => {
      console.log('offer received:', data);
      callManager.targetUserId = data.SenderID;
      callManager.roomId = data.RoomID;
      const answer = await callManager.handleOffer(data.sdp);
      socket.emit('answer', {
        targetId: data.SenderID,
        roomId: data.RoomID,
        sdp: answer.sdp
      });
      CallUI.show('connected');
    });

    socket.on('answer', async (data) => {
      console.log('answer received:', data);
      await callManager.handleAnswer(data.sdp);
    });

    socket.on('ice-candidate', async (data) => {
      console.log('ice-candidate received:', data);
      await callManager.addIceCandidate({
        candidate: data.candidate,
        sdpMid: data.sdpMid || '0',
        sdpMLineIndex: data.sdpMLineIndex ?? 0
      });
    });

    socket.on('call-ended', (data) => {
      console.log('call-ended:', data);
      if (window.ignoreCallEnded) {
        console.log('Ignoring call-ended (self-initiated)');
        return;
      }
      CallUI.end();
    });
  },

  sendCall(targetId, roomId, callType) {
    socket.emit('call', { targetId, roomId, callType });
  },

  sendAccept(targetId, roomId, callType) {
    socket.emit('accept', { targetId, roomId, callType });
  },

  sendIceCandidate(targetId, candidate) {
    socket.emit('ice-candidate', {
      targetId,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid || '0',
      sdpMLineIndex: candidate.sdpMLineIndex ?? 0
    });
  },

  sendEndCall(targetId) {
    socket.emit('end-call', { targetId });
  }
};

const CallUI = {
  show(status) {
    const type = window.callType;
    const hasVideo = callManager.localStream?.getVideoTracks().length > 0;
    
    let modal = document.getElementById('call-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'call-modal';
      modal.className = 'modal active';
      document.body.appendChild(modal);
    }

    const statusText = status === 'waiting' ? 'Ожидание...' : status === 'connected' ? 'Соединение...' : 'Звонок';
    const icon = type === 'video' ? '📹' : '📞';

    modal.innerHTML = `
      <div class="call-modal-content">
        <div class="call-status">${icon} ${statusText}</div>
        <video id="remote-video" autoplay playsinline style="width:100%;max-width:400px;background:#000;border-radius:8px;min-height:300px;"></video>
        <video id="local-video" autoplay playsinline muted style="position:absolute;bottom:80px;right:20px;width:120px;height:90px;background:#000;border-radius:8px;border:2px solid var(--ac);display:${hasVideo ? 'block' : 'none'}"></video>
        <div class="call-controls">
          <button class="btn-icon" id="toggle-mic-btn">🎤</button>
          ${hasVideo ? '<button class="btn-icon" id="toggle-camera-btn">📷</button>' : ''}
          <button class="btn-icon btn-danger" id="end-call-btn">📴</button>
        </div>
      </div>
    `;

    if (callManager.localStream) {
      document.getElementById('local-video').srcObject = callManager.localStream;
    }

    document.getElementById('toggle-mic-btn').onclick = () => this.toggleMic();
    document.getElementById('end-call-btn').onclick = () => this.end();
    if (hasVideo) {
      document.getElementById('toggle-camera-btn').onclick = () => this.toggleCamera();
    }

    if (callManager.remoteStream) {
      document.getElementById('remote-video').srcObject = callManager.remoteStream;
    }
  },

  showIncoming(data) {
    const callType = data.CallType === 'video' ? 'видеозвонок' : 'аудиозвонок';
    const caller = friends.find(f => f.id === data.SenderID);
    const callerName = caller?.display_name || caller?.email || 'Пользователь';

    let modal = document.getElementById('incoming-call-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'incoming-call-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
      <div class="modal-box" style="text-align:center;padding:30px;">
        <div style="font-size:40px;margin-bottom:20px">${data.CallType === 'video' ? '📹' : '📞'}</div>
        <h2>Входящий ${callType}</h2>
        <p style="color:var(--txF);margin:10px 0">${escapeHtml(callerName)}</p>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px">
          <button class="btn btn-primary" id="accept-call-btn">Принять</button>
          <button class="btn btn-danger" id="reject-call-btn">Отклонить</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    window.incomingCallData = data;

    document.getElementById('accept-call-btn').onclick = async () => {
      await this.acceptCall(data);
      modal.remove();
    };

    document.getElementById('reject-call-btn').onclick = () => {
      modal.remove();
      SignalingClient.sendEndCall(data.SenderID);
    };
  },

  async acceptCall(data) {
    playCallSound(null);
    
    window.callType = data.CallType;
    window.callRoomId = data.RoomID;
    window.isInCall = true;
    
    callManager.callType = data.CallType;
    callManager.targetUserId = data.SenderID;
    callManager.roomId = data.RoomID;
    
    await callManager.initLocalStream(data.CallType);
    SignalingClient.sendAccept(data.SenderID, data.RoomID, data.CallType);
    
    this.show('connected');
  },

  setConnected() {
    const statusEl = document.querySelector('.call-status');
    if (statusEl) {
      statusEl.textContent = '📞 Звонок';
    }
  },

  toggleMic() {
    if (callManager.localStream) {
      const audioTrack = callManager.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById('toggle-mic-btn').textContent = audioTrack.enabled ? '🎤' : '🔇';
      }
    }
  },

  toggleCamera() {
    if (callManager.localStream) {
      const videoTrack = callManager.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        document.getElementById('toggle-camera-btn').textContent = videoTrack.enabled ? '📷' : '📵';
      }
    }
  },

  end() {
    window.ignoreCallEnded = true;
    callManager.close();
    if (callManager.targetUserId) {
      SignalingClient.sendEndCall(callManager.targetUserId);
    }
    const modal = document.getElementById('call-modal');
    if (modal) modal.remove();
    window.isInCall = false;
    window.callRoomId = null;
    window.callType = null;
    setTimeout(() => {
      window.ignoreCallEnded = false;
    }, 500);
  }
};

function initWebRTC() {
  if (!currentUser?.id) {
    setTimeout(initWebRTC, 1000);
    return;
  }
  if (window.rtcInitialized) {
    console.log('WebRTC already initialized');
    return;
  }
  window.rtcInitialized = true;
  SignalingClient.setup();
  console.log('WebRTC initialized');
}

function setupCallButtons() {
  document.addEventListener('click', (e) => {
    const videoBtn = e.target.closest('#video-call-btn');
    if (videoBtn && selectedFriendId) {
      startCall('video');
      return;
    }
    
    const audioBtn = e.target.closest('#audio-call-btn');
    if (audioBtn && selectedFriendId) {
      startCall('audio');
      return;
    }
  });
}

async function handleSignalingMessage(data) {
  console.log('Legacy signaling handler called:', data.type);
}

async function startCall(type) {
  if (!selectedFriendId) {
    showToast('Выберите пользователя для звонка', 'error');
    return;
  }
  
  try {
    await callManager.initLocalStream(type);
    
    const roomId = generateRoomId();
    window.callType = type;
    window.callRoomId = roomId;
    window.isInCall = true;
    
    callManager.callType = type;
    callManager.targetUserId = selectedFriendId;
    callManager.roomId = roomId;
    callManager.isInitiator = true;
    
    CallUI.show('waiting');
    playCallSound('waiting');
    
    SignalingClient.sendCall(selectedFriendId, roomId, type);
    
    window.callTimeout = setTimeout(() => {
      if (window.isInCall) {
        showToast('Пользователь не отвечает', 'info');
        CallUI.end();
      }
    }, 30000);
  } catch (e) {
    console.error('Error starting call:', e);
    showToast('Ошибка доступа к камере/микрофону', 'error');
  }
}

function playCallSound(type) {
  if (callSound) {
    clearInterval(callSound);
    callSound = null;
  }
  
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  if (type === 'waiting') {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 440;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime + 0.5);
    gainNode.gain.setValueAtTime(0, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
    
    callSound = setInterval(() => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = 440;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, audioContext.currentTime);
      gain.gain.setValueAtTime(0, audioContext.currentTime + 0.3);
      osc.start(audioContext.currentTime);
      osc.stop(audioContext.currentTime + 0.3);
    }, 1000);
  } else if (type === 'ringing') {
    if (callSound) clearInterval(callSound);
    callSound = null;
  } else if (type === 'busy') {
    if (callSound) clearInterval(callSound);
    callSound = null;
  }
}

function generateRoomId() {
  return 'call-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

document.addEventListener('DOMContentLoaded', init);
