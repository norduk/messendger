const API_KEY = 'ENV_API_KEY';
const API_URL = '/admin-api';

let adminToken = sessionStorage.getItem('adminToken');
let currentPage = 'dashboard';
let currentAdmin = null;
let healthRefreshInterval = null;

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

const api = {
  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-API-Key': API_KEY,
      ...options.headers
    };
    
    if (adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    });
    
    if (response.status === 401) {
      logout();
      return { error: 'Unauthorized' };
    }
    
    return response.json();
  },
  
  get: (endpoint) => api.request(endpoint),
  post: (endpoint, body) => api.request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => api.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (endpoint) => api.request(endpoint, { method: 'DELETE' })
};

function init() {
  if (adminToken) {
    showAdminPanel();
  } else {
    showLoginScreen();
  }
  
  setupEventListeners();
}

function showLoginScreen() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-screen').style.display = 'none';
}

function showAdminPanel() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'flex';
  setupNavigation();
  setupModals();
  loadPage('dashboard');
  checkConnection();
  setInterval(checkConnection, 30000);
}

function setupEventListeners() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('login-name').value;
    const password = document.getElementById('login-password').value;
    
    try {
      const data = await fetch(`${API_URL}/admin-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password })
      }).then(r => r.json());
      
      if (data.token) {
        adminToken = data.token;
        sessionStorage.setItem('adminToken', adminToken);
        currentAdmin = data.admin;
        document.getElementById('admin-name').textContent = escapeHtml(currentAdmin.name);
        showAdminPanel();
        showToast('Добро пожаловать!', 'success');
      } else {
        document.getElementById('login-error').textContent = escapeHtml(data.error) || 'Ошибка входа';
      }
    } catch (e) {
      document.getElementById('login-error').textContent = 'Ошибка входа';
    }
  });
  
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('refresh-btn').addEventListener('click', () => loadPage(currentPage));
}

function logout() {
  adminToken = null;
  currentAdmin = null;
  sessionStorage.removeItem('adminToken');
  showLoginScreen();
}

async function checkConnection() {
  const status = document.querySelector('#connection-status span:last-child');
  try {
    const res = await api.get('/admin/health');
    if (res.status) {
      status.textContent = 'Connected';
      status.style.color = 'var(--success)';
    } else {
      status.textContent = 'Disconnected';
      status.style.color = 'var(--error)';
    }
  } catch (e) {
    status.textContent = 'Disconnected';
    status.style.color = 'var(--error)';
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      loadPage(page);
    });
  });
}

async function loadPage(page) {
  currentPage = page;
  const title = document.getElementById('page-title');
  
  switch (page) {
    case 'dashboard':
      title.textContent = 'Dashboard';
      await loadDashboard();
      break;
    case 'users':
      title.textContent = 'Users';
      await loadUsers();
      break;
    case 'invites':
      title.textContent = 'Invite Codes';
      await loadInvites();
      break;
    case 'logs':
      title.textContent = 'Admin Logs';
      await loadLogs();
      break;
    case 'health':
      title.textContent = 'Health Check';
      await loadHealth();
      break;
    case 'settings':
      title.textContent = 'Settings';
      await loadSettings();
      break;
  }
}

async function loadDashboard() {
  const content = document.getElementById('content');
  
  try {
    const stats = await api.get('/admin/stats');
    const storage = await api.get('/admin-auth/storage');
    
    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-value">${stats.users?.total || 0}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card success">
          <div class="stat-icon">✅</div>
          <div class="stat-value">${stats.users?.admins || 0}</div>
          <div class="stat-label">Admins</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-icon">🚫</div>
          <div class="stat-value">${stats.users?.blocked || 0}</div>
          <div class="stat-label">Blocked</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💬</div>
          <div class="stat-value">${stats.messages?.total || 0}</div>
          <div class="stat-label">Total Messages</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🎫</div>
          <div class="stat-value">${stats.invites?.active || 0}</div>
          <div class="stat-label">Active Invites</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">💾</div>
          <div class="stat-value">${storage?.database || 'N/A'}</div>
          <div class="stat-label">Database Size</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📁</div>
          <div class="stat-value">${storage?.uploads || 'N/A'}</div>
          <div class="stat-label">Files Storage</div>
        </div>
      </div>
      
      <div class="section-header">
        <h2>Message Statistics</h2>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.messages?.last24h || 0}</div>
          <div class="stat-label">Last 24 Hours</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.messages?.last7d || 0}</div>
          <div class="stat-label">Last 7 Days</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.messages?.last30d || 0}</div>
          <div class="stat-label">Last 30 Days</div>
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="loading">Failed to load dashboard</div>';
  }
}

async function loadHealth() {
  const content = document.getElementById('content');
  
  if (healthRefreshInterval) {
    clearInterval(healthRefreshInterval);
    healthRefreshInterval = null;
  }
  
  content.innerHTML = '<div class="loading">Loading health status...</div>';
  
  async function refreshHealth() {
    try {
      const health = await api.get('/admin/health');
      const containers = health.containers || [];
      const statusClass = health.status === 'healthy' ? 'status-healthy' : 'status-degraded';
      
      content.innerHTML = `
        <div class="section-header">
          <h2>Health Check</h2>
          <div class="health-header-actions">
            <span class="health-timestamp">Updated: ${new Date(health.timestamp).toLocaleTimeString()}</span>
            <button class="btn btn-primary btn-sm" id="refresh-health-btn">Refresh</button>
          </div>
        </div>
        
        <div class="health-overall ${statusClass}">
          <div class="health-overall-icon">${health.status === 'healthy' ? '✓' : '!'}</div>
          <div class="health-overall-text">
            <div class="health-overall-label">System Status</div>
            <div class="health-overall-value">${health.status?.toUpperCase()}</div>
          </div>
        </div>
        
        <div class="health-grid">
          ${containers.map(c => `
            <div class="health-item ${c.status === 'up' ? 'up' : 'down'}">
              <div class="health-icon">${getServiceIcon(c.name)}</div>
              <div class="health-name">${c.name}</div>
              <div class="health-status">${c.status === 'up' ? 'Running' : 'Stopped'}</div>
              <div class="health-indicator"></div>
            </div>
          `).join('')}
        </div>
        
        <div class="health-auto-refresh">
          <label class="auto-refresh-toggle">
            <input type="checkbox" id="auto-refresh-toggle" checked>
            <span class="toggle-slider"></span>
            <span class="toggle-label">Auto-refresh (10s)</span>
          </label>
        </div>
      `;
      
      document.getElementById('refresh-health-btn')?.addEventListener('click', refreshHealth);
      
      const toggle = document.getElementById('auto-refresh-toggle');
      if (toggle) {
        toggle.addEventListener('change', () => {
          if (toggle.checked) {
            healthRefreshInterval = setInterval(refreshHealth, 10000);
          } else {
            clearInterval(healthRefreshInterval);
            healthRefreshInterval = null;
          }
        });
      }
      
    } catch (e) {
      content.innerHTML = '<div class="loading">Failed to load health status</div>';
    }
  }
  
  await refreshHealth();
  healthRefreshInterval = setInterval(refreshHealth, 10000);
}

function getServiceIcon(name) {
  const icons = {
    'PostgreSQL': '🐘',
    'Redis': '🔴',
    'Messenger': '💬',
    'Sync': '🔄',
    'Files': '📁',
    'Nginx': '🌐',
    'Admin': '🛡️'
  };
  return icons[name] || '📦';
}

async function loadLogs() {
  const content = document.getElementById('content');
  
  try {
    const data = await api.get('/admin/logs');
    
    content.innerHTML = `
      <div class="section-header">
        <h2>Admin Actions</h2>
      </div>
      
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Admin</th>
              <th>Action</th>
              <th>Target User</th>
              <th>Details</th>
              <th>IP</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${data.logs?.length ? data.logs.map(log => `
              <tr>
                <td>${log.admin_name || log.admin_id?.substring(0, 8)}</td>
                <td>${log.action}</td>
                <td>${log.target_user_id?.substring(0, 8) || '-'}</td>
                <td>${log.details || '-'}</td>
                <td>${log.ip_address || '-'}</td>
                <td>${new Date(log.created_at).toLocaleString()}</td>
              </tr>
            `).join('') : '<tr><td colspan="6">No logs found</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="loading">Failed to load logs</div>';
  }
}

async function loadSettings() {
  const content = document.getElementById('content');
  
  try {
    const profile = await api.get('/admin-auth/profile');
    
    content.innerHTML = `
      <div class="settings-section">
        <h2>Профиль администратора</h2>
        <form id="profile-form" class="settings-form">
          <div class="form-group">
            <label for="admin-name-input">Имя</label>
            <input type="text" id="admin-name-input" value="${profile.admin?.name || ''}" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="text" value="${profile.admin?.email || '-'}" disabled>
          </div>
          <button type="submit" class="btn btn-primary">Сохранить имя</button>
        </form>
      </div>
      
      <div class="settings-section">
        <h2>Смена пароля</h2>
        <form id="password-form" class="settings-form">
          <div class="form-group">
            <label for="current-password">Текущий пароль</label>
            <input type="password" id="current-password" required>
          </div>
          <div class="form-group">
            <label for="new-password">Новый пароль</label>
            <input type="password" id="new-password" required minlength="8" placeholder="Минимум 8 символов">
          </div>
          <div class="form-group">
            <label for="confirm-password">Подтвердите пароль</label>
            <input type="password" id="confirm-password" required>
          </div>
          <button type="submit" class="btn btn-primary">Изменить пароль</button>
        </form>
      </div>
    `;
    
    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('admin-name-input').value;
      
      try {
        const result = await api.put('/admin-auth/profile', { name });
        if (result.message) {
          currentAdmin = { ...currentAdmin, name };
          document.getElementById('admin-name').textContent = name;
          showToast('Имя обновлено', 'success');
        } else {
          showToast(result.error || 'Ошибка', 'error');
        }
      } catch (e) {
        showToast('Ошибка сохранения', 'error');
      }
    });
    
    document.getElementById('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;
      
      if (newPassword !== confirmPassword) {
        showToast('Пароли не совпадают', 'error');
        return;
      }
      
      try {
        const result = await api.put('/admin-auth/profile', { currentPassword, newPassword });
        if (result.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Пароль изменён', 'success');
          document.getElementById('password-form').reset();
        }
      } catch (e) {
        showToast('Ошибка смены пароля', 'error');
      }
    });
  } catch (e) {
    content.innerHTML = '<div class="loading">Failed to load settings</div>';
  }
}

async function loadUsers() {
  const content = document.getElementById('content');
  
  try {
    const data = await api.get('/admin/users');
    
    content.innerHTML = `
      <div class="section-header">
        <h2>Users</h2>
      </div>
      
      <div class="filters">
        <input type="text" id="user-search" placeholder="Search users...">
        <select id="user-filter">
          <option value="">All Users</option>
          <option value="blocked">Blocked</option>
          <option value="active">Active</option>
        </select>
      </div>
      
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="users-table">
            ${renderUsers(data.users || [])}
          </tbody>
        </table>
      </div>
    `;
    
    setupUserFilters();
  } catch (e) {
    content.innerHTML = '<div class="loading">Failed to load users</div>';
  }
}

function renderUsers(users) {
  if (users.length === 0) {
    return '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No users found</td></tr>';
  }
  
  const tbody = document.createElement('tbody');
  
  users.forEach(user => {
    const tr = document.createElement('tr');
    tr.dataset.userId = user.id;
    
    tr.innerHTML = `
      <td>
        <span class="copy-id" style="font-family: monospace; font-size: 11px; cursor: pointer;">
          ${escapeHtml(user.id.substring(0, 8))}...
        </span>
      </td>
      <td>
        <div class="user-cell">
          <div class="avatar">${escapeHtml((user.display_name || user.name || 'U').charAt(0).toUpperCase())}</div>
          <span>${escapeHtml(user.display_name || user.name || 'No name')}</span>
        </div>
      </td>
      <td>${escapeHtml(user.email) || '-'}</td>
      <td>
        ${user.is_blocked 
          ? '<span class="badge badge-error">Blocked</span>' 
          : '<span class="badge badge-success">Active</span>'}
      </td>
      <td>
        ${user.is_admin 
          ? '<span class="badge badge-primary">Admin</span>' 
          : '<span class="badge badge-warning">User</span>'}
      </td>
      <td>
        <div class="actions">
          <button class="btn btn-primary btn-sm btn-edit">Edit</button>
          ${user.is_blocked 
            ? '<button class="btn btn-success btn-sm btn-unblock">Unblock</button>'
            : '<button class="btn btn-warning btn-sm btn-block">Block</button>'}
          ${user.is_admin 
            ? '<button class="btn btn-danger btn-sm btn-revoke">Revoke Admin</button>'
            : '<button class="btn btn-success btn-sm btn-make-admin">Make Admin</button>'}
          ${!user.is_admin ? '<button class="btn btn-danger btn-sm btn-delete">Delete</button>' : ''}
          <button class="btn btn-secondary btn-sm btn-storage">Storage</button>
        </div>
      </td>
    `;
    
    tr.querySelector('.copy-id')?.addEventListener('click', () => copyToClipboard(user.id));
    tr.querySelector('.btn-edit')?.addEventListener('click', () => editUser(user.id));
    tr.querySelector('.btn-unblock')?.addEventListener('click', () => unblockUser(user.id));
    tr.querySelector('.btn-block')?.addEventListener('click', () => blockUser(user.id));
    tr.querySelector('.btn-revoke')?.addEventListener('click', () => toggleAdmin(user.id, false));
    tr.querySelector('.btn-make-admin')?.addEventListener('click', () => toggleAdmin(user.id, true));
    tr.querySelector('.btn-delete')?.addEventListener('click', () => deleteUser(user.id));
    tr.querySelector('.btn-storage')?.addEventListener('click', () => showUserStorage(user.id));
    
    tbody.appendChild(tr);
  });
  
  return tbody.innerHTML;
}

function setupUserFilters() {
  const searchInput = document.getElementById('user-search');
  const filterSelect = document.getElementById('user-filter');
  
  let allUsers = [];

  api.get('/admin/users').then(data => {
    allUsers = data.users || [];
  });
  
  searchInput.addEventListener('input', () => filterUsers());
  filterSelect.addEventListener('change', () => filterUsers());
  
  function filterUsers() {
    const search = searchInput.value.toLowerCase();
    const filter = filterSelect.value;
    
    let filtered = allUsers;
    
    if (search) {
      filtered = filtered.filter(u => 
        (u.display_name || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search) ||
        u.id.toLowerCase().includes(search)
      );
    }
    
    if (filter === 'blocked') {
      filtered = filtered.filter(u => u.is_blocked);
    } else if (filter === 'active') {
      filtered = filtered.filter(u => !u.is_blocked);
    }
    
    document.getElementById('users-table').innerHTML = renderUsers(filtered);
  }
}

async function showUserStorage(userId) {
  try {
    const storage = await api.get(`/admin-auth/storage?userId=${userId}`);
    showModal('User Storage', `
      <div class="storage-info">
        <p><strong>User:</strong> ${storage.userStorage?.user?.name || 'Unknown'}</p>
        <p><strong>Messages:</strong> ${storage.userStorage?.messageCount || 0}</p>
        <p><strong>Sent Files:</strong> ${storage.userStorage?.fileCount || 0}</p>
        <p><strong>Files Size:</strong> ${storage.userStorage?.fileSize || '0 B'}</p>
      </div>
    `);
  } catch (e) {
    showToast('Failed to load storage info', 'error');
  }
}

async function blockUser(id) {
  if (!confirm('Заблокировать этого пользователя?')) return;
  
  try {
    await api.put(`/admin/users/${id}/block`);
    showToast('Пользователь заблокирован', 'success');
    loadUsers();
  } catch (e) {
    showToast('Ошибка блокировки', 'error');
  }
}

async function unblockUser(id) {
  try {
    await api.put(`/admin/users/${id}/unblock`);
    showToast('Пользователь разблокирован', 'success');
    loadUsers();
  } catch (e) {
    showToast('Ошибка разблокировки', 'error');
  }
}

async function toggleAdmin(id, isAdmin) {
  const action = isAdmin ? 'назначить администратором' : 'снять права администратора';
  if (!confirm(`${action}?`)) return;
  
  try {
    const result = await api.put(`/admin/users/${id}/admin`, { isAdmin });
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast(result.message, 'success');
      loadUsers();
    }
  } catch (e) {
    showToast('Ошибка изменения прав', 'error');
  }
}

async function editUser(id) {
  try {
    const data = await api.get('/admin/users');
    const user = data.users?.find(u => u.id === id);
    
    if (!user) {
      showToast('Пользователь не найден', 'error');
      return;
    }
    
    showModal('Редактирование пользователя', `
      <div class="edit-user-section">
        <h3>Изменить имя</h3>
        <form id="edit-user-name-form">
          <div class="form-group">
            <label for="edit-name-input">Новое имя</label>
            <input type="text" id="edit-name-input" value="${user.display_name || user.name || ''}" required minlength="2">
          </div>
          <button type="submit" class="btn btn-primary">Сохранить имя</button>
        </form>
      </div>
      
      <div class="edit-user-section">
        <h3>Изменить пароль</h3>
        <form id="edit-user-password-form">
          <div class="form-group">
            <label for="edit-password-input">Новый пароль</label>
            <input type="password" id="edit-password-input" required minlength="8" placeholder="Минимум 8 символов">
          </div>
          <div class="form-group">
            <label for="edit-confirm-password-input">Подтвердите пароль</label>
            <input type="password" id="edit-confirm-password-input" required placeholder="Повторите пароль">
          </div>
          <button type="submit" class="btn btn-primary">Изменить пароль</button>
        </form>
      </div>
    `);
    
    document.getElementById('edit-user-name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-name-input').value;
      
      try {
        const result = await api.put(`/admin/users/${id}/name`, { name });
        if (result.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Имя обновлено', 'success');
          loadUsers();
        }
      } catch (e) {
        showToast('Ошибка обновления имени', 'error');
      }
    });
    
    document.getElementById('edit-user-password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('edit-password-input').value;
      const confirmPassword = document.getElementById('edit-confirm-password-input').value;
      
      if (password !== confirmPassword) {
        showToast('Пароли не совпадают', 'error');
        return;
      }
      
      try {
        const result = await api.put(`/admin/users/${id}/password`, { password });
        if (result.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Пароль обновлён', 'success');
          closeModal();
        }
      } catch (e) {
        showToast('Ошибка обновления пароля', 'error');
      }
    });
  } catch (e) {
    showToast('Ошибка загрузки данных', 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Удалить этого пользователя? Это действие необратимо!')) return;
  if (!confirm('Все сообщения и связи пользователя будут удалены. Продолжить?')) return;
  
  try {
    const result = await api.delete(`/admin/users/${id}`);
    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast('Пользователь удалён', 'success');
      loadUsers();
    }
  } catch (e) {
    showToast('Ошибка удаления', 'error');
  }
}

async function loadInvites() {
  const content = document.getElementById('content');
  
  try {
    const data = await api.get('/admin/invites');
    
    content.innerHTML = `
      <div class="section-header">
        <h2>Invite Codes</h2>
        <button class="btn btn-primary" id="generate-invites-btn">+ Generate Invites</button>
      </div>
      
      <div class="filters">
        <select id="invite-filter">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="used">Used</option>
        </select>
      </div>
      
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Used By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="invites-table">
            ${renderInvites(data.invites || [])}
          </tbody>
        </table>
      </div>
    `;
    
    document.getElementById('generate-invites-btn').addEventListener('click', () => {
      showModal('Generate Invites', `
        <form id="generate-invites-form">
          <div class="form-group">
            <label for="invite-count">Количество кодов</label>
            <input type="number" id="invite-count" value="1" min="1" max="100">
          </div>
          <button type="submit" class="btn btn-primary">Создать</button>
        </form>
      `);
      
      document.getElementById('generate-invites-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const count = parseInt(document.getElementById('invite-count').value);
        
        try {
          const result = await api.post('/admin/invites', { count });
          if (result.invites) {
            showModal('Сгенерированные коды', `
              <p style="margin-bottom: 16px;">Скопируйте коды приглашений:</p>
              ${result.invites.map(inv => `
                <div style="margin-bottom: 12px;">
                  <span class="invite-code">${inv.code}</span>
                  <button class="copy-btn" onclick="copyToClipboard('${inv.code}')">Copy</button>
                </div>
              `).join('')}
              <button class="btn btn-primary" onclick="closeModal()">Готово</button>
            `);
            loadInvites();
          }
        } catch (e) {
          showToast('Ошибка генерации', 'error');
        }
      });
    });
    
    document.getElementById('invite-filter').addEventListener('change', async (e) => {
      const filter = e.target.value;
      const data = await api.get(`/admin/invites?isUsed=${filter === 'active' ? 'false' : filter === 'used' ? 'true' : ''}`);
      document.getElementById('invites-table').innerHTML = renderInvites(data.invites || []);
    });
  } catch (e) {
    content.innerHTML = '<div class="loading">Failed to load invites</div>';
  }
}

function renderInvites(invites) {
  if (invites.length === 0) {
    return '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No invites found</td></tr>';
  }
  
  return invites.map(invite => `
    <tr>
      <td><span class="invite-code">${invite.code}</span></td>
      <td>
        ${invite.is_used 
          ? '<span class="badge badge-error">Used</span>' 
          : '<span class="badge badge-success">Active</span>'}
      </td>
      <td>${new Date(invite.created_at).toLocaleDateString()}</td>
      <td>${new Date(invite.expires_at).toLocaleDateString()}</td>
      <td>${invite.used_by || '-'}</td>
      <td>
        <div class="actions">
          <button class="btn btn-danger btn-sm" onclick="deleteInvite('${invite.id}')">Delete</button>
          <button class="btn btn-secondary btn-sm" onclick="copyToClipboard('${invite.code}')">Copy</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteInvite(id) {
  if (!confirm('Удалить это приглашение?')) return;
  
  try {
    await api.delete(`/admin/invites/${id}`);
    showToast('Приглашение удалено', 'success');
    loadInvites();
  } catch (e) {
    showToast('Ошибка удаления', 'error');
  }
}

function setupModals() {
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
}

function showModal(title, content) {
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  
  modalContent.innerHTML = `<h2>${title}</h2>${content}`;
  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('modal').classList.remove('active');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Скопировано', 'success');
  }).catch(() => {
    showToast('Ошибка копирования', 'error');
  });
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

window.blockUser = blockUser;
window.unblockUser = unblockUser;
window.deleteUser = deleteUser;
window.editUser = editUser;
window.toggleAdmin = toggleAdmin;
window.deleteInvite = deleteInvite;
window.copyToClipboard = copyToClipboard;
window.closeModal = closeModal;
window.showUserStorage = showUserStorage;

document.addEventListener('DOMContentLoaded', init);
