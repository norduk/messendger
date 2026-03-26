# SecureMessenger

Приватный мессенджер с end-to-end шифрованием. Регистрация только по инвайтам.

## Возможности

- 🔒 End-to-end шифрование сообщений
- 👥 Друзья и мгновенные сообщения
- 📷 Отправка фото, видео, файлов
- 🎫 Регистрация по инвайтам
- 🛡️ Админ-панель для управления

## Быстрый старт

### Запуск через Docker

```bash
# Клонируйте репозиторий
cd messendger

# Запустите все сервисы
docker-compose up -d

# Создайте админ-инвайт
docker-compose exec messenger node -e "
  const { v4: uuidv4 } = require('uuid');
  console.log('Admin Invite Code:', uuidv4().toUpperCase().match(/.{1,4}/g).join('-'));
"
```

### Доступ к сервисам

- **Мессенджер**: http://localhost:3000
- **Админ-панель**: http://localhost:3001
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

### Первый админ

1. Откройте админ-панель
2. Войдите с админским инвайтом из логов или сгенерируйте новый
3. Создайте инвайты для пользователей

## Структура проекта

```
messendger/
├── docker-compose.yml     # Docker Compose конфигурация
├── Dockerfile.messenger   # Backend Dockerfile
├── Dockerfile.admin      # Admin Panel Dockerfile
├── backend/              # Node.js бэкенд
│   ├── src/
│   │   ├── index.js      # Entry point
│   │   ├── config/       # Конфигурация
│   │   ├── db/           # База данных
│   │   ├── models/       # Модели данных
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Middleware
│   │   └── services/     # WebSocket, шифрование
│   └── uploads/          # Файлы
├── messenger-frontend/   # Фронтенд мессенджера
└── admin-frontend/       # Админ-панель
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Регистрация (нужен invite)
- `POST /api/auth/login` - Вход
- `POST /api/auth/logout` - Выход
- `POST /api/auth/refresh` - Обновление токена
- `GET /api/auth/me` - Текущий пользователь

### Users
- `GET /api/users/search?q=` - Поиск
- `GET /api/users/:id` - Профиль
- `PUT /api/users/profile` - Обновление профиля

### Friends
- `GET /api/friends` - Список друзей
- `POST /api/friends/request` - Запрос в друзья
- `PUT /api/friends/request/:id` - Принять/отклонить
- `DELETE /api/friends/:id` - Удалить

### Messages
- `GET /api/messages/:friendId` - История
- `POST /api/messages/:friendId` - Отправить
- `PUT /api/messages/:id/read` - Прочитано
- `DELETE /api/messages/:id` - Удалить

### Admin
- `GET /api/admin/stats` - Статистика
- `GET /api/admin/users` - Пользователи
- `PUT /api/admin/users/:id/block` - Заблокировать
- `POST /api/admin/invites` - Создать инвайты
- `GET /api/admin/health` - Health check
- `GET /api/admin/logs` - Логи

## Разработка

### Локальный запуск

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend Messenger (в отдельном терминале)
cd messenger-frontend
npm install
npm run dev

# Frontend Admin (в отдельном терминале)
cd admin-frontend
npm install
npx serve .
```

### WebSocket Events

Клиент → Сервер:
- `auth` - Аутентификация
- `message` - Отправка сообщения
- `typing` - Индикатор печати
- `read` - Прочитано

Сервер → Клиент:
- `message` - Новое сообщение
- `message_status` - Статус сообщения
- `typing` - Кто-то печатает
- `user_online` - Пользователь онлайн

## Безопасность

- Все пароли через bcrypt (12 раундов)
- JWT токены с коротким сроком жизни
- Rate limiting на все endpoints
- CORS настроен
- Helmet.js для заголовков безопасности
- E2E шифрование сообщений

## Environment Variables

См. `.env.example` для списка переменных окружения.

## Лицензия

MIT
