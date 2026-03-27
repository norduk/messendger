const API_URL = '/api';
const SYNC_URL = '/sync-api';
let accessToken = localStorage.getItem('accessToken');
let syncToken = localStorage.getItem('syncToken');
let currentUser = null;
let socket = null;
let selectedFriendId = null;
let friends = [];
let messages = {};
let lastSyncTime = null;
let selectedMessages = new Set();
let isSelectionMode = false;

function getStorageKey(userId) {
  return `messenger_messages_${userId}`;
}
function getSyncKeyKey(userId) {
  return `messenger_sync_key_${userId}`;
}
function getLastSyncKey(userId) {
  return `messenger_last_sync_${userId}`;
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

function loadLastSyncTime(userId) {
  return localStorage.getItem(getLastSyncKey(userId));
}

function saveLastSyncTime(userId) {
  localStorage.setItem(getLastSyncKey(userId), Date.now().toString());
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
    
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include'
    });
    
    if (response.status === 401) {
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        const retryResponse = await fetch(`${API_URL}${endpoint}`, {
          ...options,
          headers
        });
        return retryResponse.json();
      } else {
        logout();
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
        localStorage.setItem('accessToken', accessToken);
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
  
  async sync(localMessages) {
    return this.request('/api/sync/sync', {
      method: 'POST',
      body: JSON.stringify({
        messages: localMessages,
        lastSync: lastSyncTime
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
      localStorage.setItem('syncToken', syncToken);
      localStorage.setItem(SYNC_KEY_KEY, password);
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
    const result = await syncApi.sync(allMessages);
    
    if (result.messages) {
      const merged = {};
      for (const msg of result.messages) {
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
  setupMessageDelete();
  setupMobileMenu();
  
  if (accessToken) {
    loadUser();
  } else {
    showScreen('auth');
  }
}

function setupMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const mobileMenuBtnEmpty = document.getElementById('mobile-menu-btn-empty');
  
  let overlay = document.querySelector('.mobile-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';
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
      overlay.classList.remove('active');
    }
  });
  
  if (mobileMenuBtnEmpty) {
    mobileMenuBtnEmpty.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });
  }
  
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });
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
        localStorage.setItem('accessToken', accessToken);
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
        localStorage.setItem('accessToken', accessToken);
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
      localStorage.removeItem('accessToken');
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
    
    if (currentUser?.id) {
      messages = loadMessagesFromStorage(currentUser.id);
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
  if (currentUser.avatarUrl) {
    avatarEl.innerHTML = `<img src="${currentUser.avatarUrl}" class="avatar-img" alt="Avatar">`;
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
  showModal('Мой профиль', `
    <div class="profile-container">
      <div class="profile-avatar">
        ${currentUser.avatarUrl ? 
          `<img src="${currentUser.avatarUrl}" class="profile-avatar-img" alt="Avatar">` : 
          `<div class="profile-avatar-placeholder">${(currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase()}</div>`
        }
      </div>
      <div class="profile-name">${currentUser.displayName || 'Без имени'}</div>
      ${currentUser.nickname ? `<div class="profile-nickname">@${currentUser.nickname}</div>` : ''}
      <div class="profile-status online">● В сети</div>
      <div class="profile-details">
        ${currentUser.nickname ? `
        <div class="profile-item">
          <span class="profile-label">ID</span>
          <span class="profile-value" style="cursor: pointer;" title="Нажмите чтобы скопировать" onclick="navigator.clipboard.writeText('@${currentUser.nickname}'); showToast('ID скопирован', 'success');">@${currentUser.nickname}</span>
        </div>` : `
        <div class="profile-item">
          <span class="profile-label">ID</span>
          <span class="profile-value" style="font-family: monospace; font-size: 11px; cursor: pointer;" title="Нажмите чтобы скопировать" onclick="navigator.clipboard.writeText('${currentUser.id}'); showToast('ID скопирован', 'success');">${currentUser.id}</span>
        </div>`}
        ${currentUser.email ? `<div class="profile-item">
          <span class="profile-label">Email</span>
          <span class="profile-value">${currentUser.email}</span>
        </div>` : ''}
        ${currentUser.phone ? `<div class="profile-item">
          <span class="profile-label">Телефон</span>
          <span class="profile-value">${currentUser.phone}</span>
        </div>` : ''}
      </div>
    </div>
  `);
}

function setupSocket() {
  try {
    const socketUrl = window.location.hostname === 'localhost' 
      ? `http://localhost:3000` 
      : window.location.origin;
    
    console.log('Connecting to socket:', socketUrl);
    
    socket = io(socketUrl, {
      auth: { token: accessToken }
    });
    
    socket.on('connect', () => {
      console.log('Socket connected');
    });
    
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
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
    });
    
    socket.on('typing', (data) => {
      showTypingIndicator(data.userId);
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
    list.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <p>Нет друзей</p>
        <p style="font-size: 12px; margin-top: 8px;">Добавьте друга чтобы начать общение</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = friends.map(friend => `
    <div class="contact-item ${selectedFriendId === friend.id ? 'active' : ''}" data-id="${friend.id}">
      <div class="avatar small ${friend.status === 'online' ? 'online' : ''}">${friend.avatarUrl ? `<img src="${friend.avatarUrl}" class="avatar-img" alt="Avatar">` : (friend.display_name || friend.email).charAt(0).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${friend.display_name || friend.email}</div>
        <div class="contact-preview">${getLastMessagePreview(friend.id)}</div>
      </div>
      <div class="contact-meta">
        <span class="contact-time">${formatTime(messages[friend.id]?.slice(-1)[0]?.createdAt)}</span>
        ${getUnreadCount(friend.id) > 0 ? `<span class="unread-badge">${getUnreadCount(friend.id)}</span>` : ''}
      </div>
    </div>
  `).join('');
  
  list.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => selectChat(item.dataset.id));
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
  document.querySelector('.mobile-overlay')?.classList.remove('active');
  
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
}

function renderChatArea(friend) {
  selectedMessages.clear();
  isSelectionMode = false;
  
  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = `
    <div class="chat-header">
      <button class="mobile-back-btn" id="mobile-back-btn">◀</button>
      <div class="chat-header-info" id="chat-header-info" data-friend-id="${friend.id}" style="cursor: pointer;">
        <div class="avatar small ${friend.status === 'online' ? 'online' : ''}">${friend.avatarUrl ? `<img src="${friend.avatarUrl}" class="avatar-img" alt="Avatar">` : (friend.display_name || friend.email).charAt(0).toUpperCase()}</div>
        <div>
          <div class="user-name">${friend.display_name || friend.email}</div>
          <div class="user-status">${friend.status === 'online' ? 'В сети' : 'Не в сети'}</div>
        </div>
      </div>
      <div class="chat-header-actions">
        <button class="btn-icon" id="select-messages-btn" title="Выбрать">☑️</button>
      </div>
    </div>
    <div class="selection-bar" id="selection-bar" style="display: none;">
      <button class="btn-icon" id="cancel-selection-btn" title="Отмена">✖️</button>
      <span id="selection-count">Выбрано: 0</span>
      <button class="btn btn-danger btn-sm" id="delete-selected-btn">Удалить выбранные</button>
    </div>
    <div class="chat-messages scrollbar" id="chat-messages"></div>
    <div class="typing-indicator" id="typing-indicator" style="display: none;"></div>
    <div class="chat-input-container">
      <div class="chat-input-wrapper">
        <input type="file" id="file-input" class="file-input" accept="image/*,video/*,.pdf,.doc,.docx">
        <button class="btn-icon attach-btn" id="attach-btn" title="Прикрепить">📎</button>
        <textarea class="chat-input" id="message-input" placeholder="Сообщение" rows="1"></textarea>
        <button class="btn-send" id="send-btn">➤</button>
      </div>
    </div>
  `;
  
  setupMessageInput();
  setupSelectionMode();
  
  document.getElementById('chat-header-info').addEventListener('click', () => showFriendProfile(friend.id));
  
  document.getElementById('mobile-back-btn').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.add('open');
    document.querySelector('.mobile-overlay')?.classList.add('active');
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
      });
      if (currentUser?.id) saveMessagesToStorage(currentUser.id);
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
  
  const tempId = Date.now();
  const encryptedContent = btoa(unescape(encodeURIComponent(content)));
  
  const messageData = {
    recipientId: selectedFriendId,
    encryptedContent,
    contentType: 'text',
    tempId
  };
  
  if (!messages[selectedFriendId]) messages[selectedFriendId] = [];
  
  messages[selectedFriendId].push({
    id: tempId,
    sender_id: currentUser.id,
    encrypted_content: encryptedContent,
    content_type: 'text',
    status: 'sent',
    created_at: new Date().toISOString(),
    temp: true
  });
  
  if (currentUser?.id) saveMessagesToStorage(currentUser.id);
  renderMessages(selectedFriendId);
  input.value = '';
  input.style.height = 'auto';
  
  socket.emit('message', messageData);
  
  try {
    const result = await api.post(`/messages/${selectedFriendId}`, {
      encryptedContent,
      contentType: 'text'
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

function renderMessages(friendId) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const friendMessages = messages[friendId] || [];
  
  container.innerHTML = friendMessages.map(msg => {
    const isSent = msg.sender_id === currentUser.id;
    let content = msg.encrypted_content;
    
    if (msg.content_type === 'text') {
      try {
        content = decodeURIComponent(escape(atob(msg.encrypted_content)));
      } catch (e) {
        content = msg.encrypted_content;
      }
    }
    
    const fileUrl = msg.file_url || '';
    const fullUrl = fileUrl.startsWith('/') ? `${window.location.origin}/api${fileUrl}` : fileUrl;
    const isSelected = selectedMessages.has(msg.id);
    
    return `
      <div class="message ${isSent ? 'sent' : 'received'} ${isSelected ? 'selected' : ''}" data-id="${msg.id}" data-friend-id="${friendId}">
        ${isSelectionMode && isSent ? `
          <div class="message-checkbox">
            <input type="checkbox" class="msg-checkbox" data-msg-id="${msg.id}" ${isSelected ? 'checked' : ''}>
          </div>
        ` : ''}
        ${msg.content_type === 'text' ? `<div class="message-content">${escapeHtml(content)}</div>` : ''}
        ${msg.content_type === 'image' && fileUrl ? `<img src="${fullUrl}" class="message-image clickable-image" alt="Изображение" data-full-url="${fullUrl}">` : ''}
        ${msg.content_type === 'file' && fileUrl ? `
          <a href="${fullUrl}" target="_blank" class="message-file">
            📄 ${msg.file_name || 'Файл'}
          </a>
        ` : ''}
        <div class="message-meta">
          <span>${formatTime(msg.created_at)}</span>
          ${isSent ? `<span class="message-status">${getStatusIcon(msg.status)}</span>` : ''}
          ${isSent && !isSelectionMode ? `<button class="delete-msg-btn" data-msg-id="${msg.id}" data-friend-id="${friendId}" title="Удалить">🗑</button>` : ''}
          ${msg.file_url && isSent && !isSelectionMode ? `<button class="delete-file-btn" data-msg-id="${msg.id}" data-friend-id="${friendId}" title="Удалить файл">📄🗑</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.scrollTop = container.scrollHeight;
}

function setupMessageDelete() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-msg-btn');
    if (btn) {
      const msgId = btn.dataset.msgId;
      const friendId = btn.dataset.friendId;
      deleteMessage(msgId, friendId);
    }
    
    const fileBtn = e.target.closest('.delete-file-btn');
    if (fileBtn) {
      const msgId = fileBtn.dataset.msgId;
      const friendId = fileBtn.dataset.friendId;
      deleteMessage(msgId, friendId);
    }
    
    const img = e.target.closest('.clickable-image');
    if (img && !isSelectionMode) {
      const fullUrl = img.dataset.fullUrl;
      if (fullUrl) {
        window.open(fullUrl, '_blank');
      }
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
      e.target.closest('.message').classList.toggle('selected', e.target.checked);
    }
  });
}

async function deleteMessage(msgId, friendId) {
  if (!confirm('Удалить сообщение?')) return;
  
  try {
    const result = await api.delete(`/messages/${msgId}`);
    if (result.message) {
      messages[friendId] = messages[friendId].filter(m => m.id !== msgId);
      if (currentUser?.id) saveMessagesToStorage(currentUser.id);
      renderMessages(friendId);
      showToast('Сообщение удалено', 'success');
    } else {
      showToast(result.error || 'Ошибка удаления', 'error');
    }
  } catch (e) {
    showToast('Ошибка удаления', 'error');
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

function showTypingIndicator(userId) {
  const indicator = document.getElementById('typing-indicator');
  const friend = friends.find(f => f.id === userId);
  if (indicator && friend) {
    indicator.textContent = `${friend.display_name || friend.email} печатает...`;
    indicator.style.display = 'block';
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
      indicator.style.display = 'none';
    }, 2000);
  }
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
  
  list.innerHTML = requests.map(req => `
    <div class="request-item">
      <div class="avatar small">${(req.display_name || req.email).charAt(0).toUpperCase()}</div>
      <div class="request-info">
        <div class="contact-name">${req.display_name || req.email}</div>
        <div class="contact-preview">${req.email}</div>
      </div>
      <div class="request-actions">
        <button class="btn btn-accept" data-id="${req.id}">Принять</button>
        <button class="btn btn-decline" data-id="${req.id}">Отклонить</button>
      </div>
    </div>
  `).join('');
  
  list.querySelectorAll('.btn-accept').forEach(btn => {
    btn.addEventListener('click', () => handleRequest(btn.dataset.id, 'accept'));
  });
  
  list.querySelectorAll('.btn-decline').forEach(btn => {
    btn.addEventListener('click', () => handleRequest(btn.dataset.id, 'decline'));
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
  
  container.innerHTML = users.map(user => `
    <div class="contact-item" data-identifier="${user.id}">
      <div class="avatar small">${(user.displayName || user.name || 'U').charAt(0).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-name">${user.displayName || user.name || 'Unknown'}</div>
        <div class="contact-preview" style="font-size: 10px; opacity: 0.7;">ID: ${user.id.substring(0, 8)}...</div>
      </div>
    </div>
  `).join('');
  
  document.querySelector('.search-container').appendChild(container);
  
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
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  document.querySelector('.modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) closeModal();
  });
  
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-back-btn').addEventListener('click', closeSettings);
  
  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSettingsTab(btn.dataset.settingsTab);
    });
  });
}

function openSettings() {
  document.querySelector('.chat-area').style.display = 'none';
  document.getElementById('settings-panel').classList.add('active');
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('.mobile-overlay')?.classList.remove('active');
  
  document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.settings-nav-btn[data-settings-tab="profile"]').classList.add('active');
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
    <div class="profile-view" id="profile-view-mode">
      <div class="profile-avatar-large">
        ${currentUser.avatarUrl ? 
          `<img src="${currentUser.avatarUrl}" class="avatar-img" alt="Avatar">` : 
          `<div class="profile-avatar-placeholder">${(currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase()}</div>`
        }
      </div>
      <div class="profile-display-name">${currentUser.displayName || 'Без имени'}</div>
      ${currentUser.nickname ? `<div class="profile-display-nickname">@${currentUser.nickname}</div>` : ''}
      <div class="profile-status-text">${isOnline ? '● В сети' : '○ Не в сети'}</div>
      
      <div class="profile-info-list">
        <div class="profile-info-item">
          <div class="profile-info-icon">${currentUser.nickname ? '@' : '🆔'}</div>
          <div class="profile-info-details">
            <div class="profile-info-label">ID</div>
            <div class="profile-info-value" style="${currentUser.nickname ? '' : 'font-family: monospace;'} cursor: pointer;" onclick="navigator.clipboard.writeText('${currentUser.nickname ? '@' + currentUser.nickname : currentUser.id}'); showToast('ID скопирован', 'success');">${currentUser.nickname ? '@' + currentUser.nickname : currentUser.id}</div>
          </div>
        </div>
        ${currentUser.email ? `
        <div class="profile-info-item">
          <div class="profile-info-icon">✉️</div>
          <div class="profile-info-details">
            <div class="profile-info-label">Email</div>
            <div class="profile-info-value">${currentUser.email}</div>
          </div>
        </div>` : ''}
        ${currentUser.phone ? `
        <div class="profile-info-item">
          <div class="profile-info-icon">📱</div>
          <div class="profile-info-details">
            <div class="profile-info-label">Телефон</div>
            <div class="profile-info-value">${currentUser.phone}</div>
          </div>
        </div>` : ''}
      </div>
      
      <button class="btn btn-primary" id="edit-profile-btn">Редактировать профиль</button>
    </div>
    
    <div class="profile-edit-section" id="profile-edit-mode">
      <div class="edit-avatar-row">
        <div class="edit-avatar-preview" id="edit-avatar-preview">
          ${currentUser.avatarUrl ? 
            `<img src="${currentUser.avatarUrl}" class="avatar-img" alt="Avatar">` : 
            `<div class="profile-avatar-placeholder" style="font-size: 24px;">${(currentUser.displayName || currentUser.email || 'U').charAt(0).toUpperCase()}</div>`
          }
        </div>
        <div class="edit-avatar-info">
          <p>Рекомендуемый размер: 200x200px</p>
          <input type="file" id="edit-avatar-input" class="file-input" accept="image/jpeg,image/png,image/gif,image/webp">
          <button class="btn btn-secondary btn-sm" id="edit-avatar-btn">Изменить аватар</button>
        </div>
      </div>
      
      <div class="edit-form">
        <div class="edit-field">
          <label for="edit-name">Имя</label>
          <input type="text" id="edit-name" value="${currentUser.displayName || ''}" placeholder="Введите имя">
        </div>
        <div class="edit-field">
          <label for="edit-nickname">Никнейм</label>
          <input type="text" id="edit-nickname" value="${currentUser.nickname || ''}" placeholder="myname" pattern="[a-zA-Z0-9_]+">
          <small style="color: var(--text-secondary); font-size: 11px;">Только латиница, цифры и _</small>
        </div>
        <div class="edit-field">
          <label for="edit-email">Email</label>
          <input type="email" id="edit-email" value="${currentUser.email || ''}" placeholder="example@mail.com">
        </div>
        <div class="edit-field">
          <label for="edit-phone">Мобильный телефон</label>
          <input type="tel" id="edit-phone" value="${currentUser.phone || ''}" placeholder="+7 (___) ___-__-__">
        </div>
        <div class="edit-actions">
          <button class="btn btn-ghost" id="cancel-edit-btn">Отмена</button>
          <button class="btn btn-primary" id="save-profile-btn">Сохранить</button>
        </div>
      </div>
    </div>
    
    <div class="logout-section">
      <button class="btn btn-logout" id="settings-logout-btn">Выйти из аккаунта</button>
    </div>
  `;
  
  document.getElementById('edit-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = 'none';
    document.getElementById('profile-edit-mode').classList.add('active');
  });
  
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    document.getElementById('profile-view-mode').style.display = '';
    document.getElementById('profile-edit-mode').classList.remove('active');
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
  
  container.innerHTML = `
    <div class="settings-section">
      <h3>Безопасность</h3>
      <div class="profile-info-list">
        <div class="profile-info-item">
          <div class="profile-info-icon">🔐</div>
          <div class="profile-info-details">
            <div class="profile-info-label">Статус аккаунта</div>
            <div class="profile-info-value" style="color: var(--success);">Активен</div>
          </div>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Синхронизация</h3>
      <div class="profile-info-list">
        <div class="profile-info-item">
          <div class="profile-info-icon">🔄</div>
          <div class="profile-info-details">
            <div class="profile-info-label">Статус</div>
            <div class="profile-info-value" style="color: var(--success);">Автоматически каждые 10 мин.</div>
          </div>
        </div>
        <div class="profile-info-item">
          <div class="profile-info-icon">🕐</div>
          <div class="profile-info-details">
            <div class="profile-info-label">Последняя синхронизация</div>
            <div class="profile-info-value">${lastSync}</div>
          </div>
        </div>
      </div>
    </div>
  `;
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
  accessToken = null;
  syncToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('syncToken');
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
    if (userData.user?.lastSeen) {
      lastSeen = userData.user.lastSeen;
    }
    if (userData.user?.nickname) {
      nickname = userData.user.nickname;
    }
  } catch (e) {
    console.error('Failed to get online status:', e);
  }
  
  const lastSeenText = isOnline ? 'В сети' : (lastSeen ? formatLastSeen(lastSeen) : 'Недавно');
  const displayName = friend.display_name || friend.email;
  const displayId = nickname ? `@${nickname}` : friend.id;
  
  showModal('Профиль', `
    <div class="profile-container">
      <div class="profile-avatar">
        ${friend.avatarUrl ? 
          `<img src="${friend.avatarUrl}" class="profile-avatar-img" alt="Avatar">` : 
          `<div class="profile-avatar-placeholder">${displayName.charAt(0).toUpperCase()}</div>`
        }
      </div>
      <div class="profile-name">${displayName}</div>
      ${nickname ? `<div class="profile-nickname">@${nickname}</div>` : ''}
      <div class="profile-status ${isOnline ? 'online' : ''}">${isOnline ? '● В сети' : '○ Не в сети'}</div>
      <div class="profile-details">
        <div class="profile-item">
          <span class="profile-label">ID</span>
          <span class="profile-value" style="${nickname ? '' : 'font-family: monospace; font-size: 11px;'} cursor: pointer;" title="Нажмите чтобы скопировать" onclick="navigator.clipboard.writeText('${displayId}'); showToast('ID скопирован', 'success');">${displayId}</span>
        </div>
        ${friend.email ? `<div class="profile-item">
          <span class="profile-label">Email</span>
          <span class="profile-value">${friend.email}</span>
        </div>` : ''}
        <div class="profile-item">
          <span class="profile-label">Последний онлайн</span>
          <span class="profile-value">${lastSeenText}</span>
        </div>
      </div>
    </div>
  `);
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

document.addEventListener('DOMContentLoaded', init);
