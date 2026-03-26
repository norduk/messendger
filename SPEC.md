# SecureMessenger - Спецификация

## 1. Концепция и Видение

SecureMessenger — приватный мессенджер с end-to-end шифрованием, где безопасность и минимализм стоят на первом месте. Интерфейс чистый, тёмный, с акцентом на контент. Регистрация только по инвайтам создаёт ощущение закрытого клуба. Архитектура с двумя контейнерами (основной + админка) обеспечивает изоляцию и безопасность.

## 2. Дизайн-система

### Цветовая палитра
- **Primary**: `#6366F1` (индиго)
- **Secondary**: `#8B5CF6` (фиолетовый)
- **Accent**: `#22D3EE` (циан)
- **Background**: `#0F0F0F` (почти чёрный)
- **Surface**: `#1A1A1A` (карточки)
- **Surface-alt**: `#252525` (hover)
- **Text-primary**: `#FFFFFF`
- **Text-secondary**: `#A1A1AA`
- **Success**: `#22C55E`
- **Error**: `#EF4444`
- **Warning**: `#F59E0B`

### Типографика
- **Заголовки**: Inter, 600-700 weight
- **Текст**: Inter, 400-500 weight
- **Моноширинный**: JetBrains Mono (для кодов, логов)

### Spacing система
- 4px базовая единица
- xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px

### Анимации
- Переходы: 150ms ease-out
- Модалки: scale 0.95→1, opacity 0→1, 200ms
- Hover эффекты на кнопках и карточках

## 3. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        Docker Network                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                    ┌──────────────────┐   │
│  │   Messenger  │◄──────────────────►│   Admin Panel    │   │
│  │   (Port 3000)│   Internal API     │   (Port 3001)    │   │
│  └──────┬───────┘                    └────────┬─────────┘   │
│         │                                     │              │
│         │         ┌─────────────┐             │              │
│         └────────►│ PostgreSQL  │◄────────────┘              │
│                   │   (Port 5432)│                            │
│                   └─────────────┘                            │
│                                                              │
│                   ┌─────────────┐                            │
│                   │    Redis    │                            │
│                   │  (Port 6379)│                            │
│                   └─────────────┘                            │
│                                                              │
│                   ┌─────────────┐                            │
│                   │  MinIO/S3   │                            │
│                   │  (File Store)│                            │
│                   └─────────────┘                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. Структура проекта

```
/messendger
├── docker-compose.yml
├── Dockerfile.messenger
├── Dockerfile.admin
├── SPEC.md
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.js              # Entry point
│   │   ├── config/
│   │   │   └── index.js          # Конфигурация
│   │   ├── db/
│   │   │   ├── postgres.js       # PostgreSQL connection
│   │   │   ├── redis.js          # Redis connection
│   │   │   └── migrations/       # Миграции БД
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   ├── Message.js
│   │   │   ├── Invite.js
│   │   │   └── Friendship.js
│   │   ├── routes/
│   │   │   ├── auth.js           # Регистрация, вход
│   │   │   ├── users.js          # Профили
│   │   │   ├── messages.js       # Сообщения
│   │   │   ├── invites.js        # Инвайты
│   │   │   ├── files.js          # Файлы
│   │   │   └── admin.js          # Admin API
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   ├── admin.js
│   │   │   └── validation.js
│   │   ├── services/
│   │   │   ├── encryption.js     # E2E шифрование
│   │   │   ├── websocket.js      # Socket.io
│   │   │   └── fileUpload.js     # Загрузка файлов
│   │   └── utils/
│   │       ├── logger.js
│   │       └── helpers.js
│   └── uploads/                  # Локальное хранилище (fallback)
├── messenger-frontend/
│   ├── package.json
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── styles/
│   └── index.html
└── admin-frontend/
    ├── package.json
    ├── src/
    └── index.html
```

## 5. Функциональность

### 5.1 Аутентификация

**Регистрация (только по инвайту):**
- Email + Password
- Обязательный invite code (формат: XXXX-XXXX-XXXX-XXXX)
- После успешной регистрации invite деактивируется
- Пароль хешируется через bcrypt (12 rounds)

**Вход:**
- Email + Password
- JWT токен (access: 15min, refresh: 7 days)
- Refresh token хранится в HTTP-only cookie

### 5.2 Друзья

- Отправка заявки в друзья по email
- Принятие/отклонение заявки
- Список друзей с онлайн-статусом
- Удаление из друзей

### 5.3 Сообщения

**Типы контента:**
- Текст (до 10000 символов)
- Изображения (JPEG, PNG, GIF, WebP - до 10MB)
- Видео (MP4, WebM - до 100MB)
- Файлы (любой тип - до 50MB)

**Шифрование:**
- E2E с использованием libsodium (X25519, BLAKE2b)
- При регистрации генерируется ключевая пара
- Публичный ключ хранится на сервере
- Приватный ключ зашифрован паролем пользователя и хранится локально
- Сообщения шифруются перед отправкой

**Функции:**
- Отправка текстовых сообщений
- Отправка файлов с превью
- Статусы: отправлено → доставлено → прочитано
- Индикатор печати
- История сообщений с пагинацией

### 5.4 Админ-панель

**Управление пользователями:**
- Список всех пользователей с фильтрами
- Блокировка/разблокировка
- Просмотр профиля
- Принудительный выход

**Инвайты:**
- Генерация новых invite кодов
- Список активных/использованных инвайтов
- Отзыв неиспользованных инвайтов

**Мониторинг:**
- Health Check (статус всех сервисов)
- Логи приложения (последние 1000 записей)
- Статистика:
  - Активные пользователи (24h, 7d, 30d)
  - Количество сообщений
  - Размер хранилища
  - Сетевой трафик

**Настройки:**
- Изменение своего пароля админа

## 6. API Endpoints

### Auth
```
POST /api/auth/register     - Регистрация (требует invite)
POST /api/auth/login        - Вход
POST /api/auth/logout       - Выход
POST /api/auth/refresh       - Обновление токена
GET  /api/auth/me           - Текущий пользователь
```

### Users
```
GET  /api/users/search      - Поиск пользователей
GET  /api/users/:id         - Профиль пользователя
PUT  /api/users/profile     - Обновление профиля
PUT  /api/users/keys        - Обновление публичного ключа
```

### Friends
```
GET  /api/friends           - Список друзей
POST /api/friends/request   - Отправить заявку
PUT  /api/friends/request/:id - Принять/отклонить
DELETE /api/friends/:id     - Удалить друга
```

### Messages
```
GET  /api/messages/:friendId        - История сообщений
POST /api/messages/:friendId        - Отправить сообщение
PUT  /api/messages/:id/read         - Отметить прочитанным
DELETE /api/messages/:id            - Удалить сообщение
```

### Files
```
POST /api/files/upload      - Загрузить файл
GET  /api/files/:id         - Скачать файл
GET  /api/files/:id/thumbnail - Превью изображения
```

### Admin (требует роль admin)
```
GET  /api/admin/users               - Список пользователей
PUT  /api/admin/users/:id/block     - Заблокировать
PUT  /api/admin/users/:id/unblock   - Разблокировать
DELETE /api/admin/users/:id         - Удалить
GET  /api/admin/invites             - Список инвайтов
POST /api/admin/invites             - Создать инвайт
DELETE /api/admin/invites/:id       - Удалить инвайт
GET  /api/admin/stats               - Статистика
GET  /api/admin/health              - Health check
GET  /api/admin/logs                - Логи
```

## 7. База данных (PostgreSQL)

### Users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| email | VARCHAR(255) | unique |
| password_hash | VARCHAR(255) | bcrypt |
| public_key | TEXT | E2E public key |
| display_name | VARCHAR(100) | |
| avatar_url | TEXT | |
| is_blocked | BOOLEAN | |
| is_admin | BOOLEAN | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### Invites
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| code | VARCHAR(19) | unique |
| created_by | UUID | FK users |
| used_by | UUID | FK users, nullable |
| used_at | TIMESTAMP | |
| expires_at | TIMESTAMP | |
| created_at | TIMESTAMP | |

### Friendships
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| user_id | UUID | FK users |
| friend_id | UUID | FK users |
| status | ENUM | pending/accepted/declined |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

### Messages
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | PK |
| sender_id | UUID | FK users |
| recipient_id | UUID | FK users |
| encrypted_content | TEXT | E2E encrypted |
| content_type | ENUM | text/image/video/file |
| file_url | TEXT | nullable |
| file_name | VARCHAR(255) | |
| file_size | INTEGER | bytes |
| status | ENUM | sent/delivered/read |
| created_at | TIMESTAMP | |

## 8. WebSocket Events

### Client → Server
- `auth` - Аутентификация по JWT
- `message` - Отправка сообщения
- `typing` - Индикатор печати
- `read` - Прочитано
- `online` - Пинг для поддержания соединения

### Server → Client
- `message` - Новое сообщение
- `message_status` - Статус сообщения
- `typing` - Кто-то печатает
- `friend_status` - Онлайн/оффлайн статус друга
- `notification` - Системные уведомления

## 9. Docker конфигурация

### Volumes
- `./data/postgres` - PostgreSQL data
- `./data/redis` - Redis data
- `./uploads` - File storage

### Environment Variables
```
# Messenger
PORT=3000
DATABASE_URL=postgresql://user:pass@postgres:5432/messenger
REDIS_URL=redis://redis:6379
JWT_SECRET=<secret>
ADMIN_SECRET=<admin-setup-secret>

# Admin Panel
ADMIN_PORT=3001
ADMIN_API_URL=http://messenger:3000
ADMIN_API_KEY=<internal-api-key>
```

## 10. Безопасность

- Все пароли через bcrypt (12 rounds)
- JWT с коротким сроком жизни
- Rate limiting на все endpoints
- Валидация всех входящих данных
- CORS настроен строго
- Helmet.js для заголовков безопасности
- Sanitization HTML в сообщениях (но не в E2E данных)
