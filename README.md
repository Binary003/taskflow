# TaskFlow — Assignment Version

TaskFlow is a React task manager with List, Grid, Kanban and Section views, automatic 2-hour SLAs, live countdowns, overdue indicators, completion-time tracking, task CRUD, and basic MongoDB-backed login/signup.

## What persists?

- User accounts are stored in MongoDB. Passwords are stored as bcrypt hashes, not plaintext.
- Tasks are stored in MongoDB and belong to the user who created them.
- Refreshing the page keeps the login session (until the 7-day JWT expires) and reloads tasks from MongoDB.
- Signing out removes the local login token only. It does not delete tasks. Logging back into the same account loads the same tasks.
- Different accounts have separate task lists.
- The server sets `createdAt` and `dueAt` (createdAt + 2 hours), and records `completedAt` when a task is marked done. The frontend updates the countdown every second.

## Requirements

- Node.js 18 or newer
- A MongoDB Atlas cluster (or local MongoDB)

## 1. Configure MongoDB/backend

1. In MongoDB Atlas, create a database user and allow your development IP in Network Access.
2. Copy `server/.env.example` to `server/.env`.
3. Set `MONGODB_URI` to your Atlas connection string and set `JWT_SECRET` to a long random value.
   If startup reports `querySrv ECONNREFUSED`, add `MONGODB_DNS_SERVERS=8.8.8.8`
   (or another DNS server available on your network) to `server/.env`.
4. In a terminal:

   ```bash
   cd server
   npm install
   npm run dev
   ```

The API runs at `http://localhost:5000`. Test `http://localhost:5000/api/health` for `{ "status": "ok" }`.

## 2. Run the React frontend

Open a second terminal:

```bash
cd client
npm install
```

Copy `client/.env.example` to `client/.env` (the default API URL is already correct), then run:

```bash
npm run dev
```

Open the local URL Vite prints, usually `http://localhost:5173`.

## Basic API routes

- `POST /api/auth/signup` — create account and return a token
- `POST /api/auth/login` — verify email/password and return a token
- `GET /api/auth/me` — verify the current session
- `GET /api/tasks` — list the logged-in user's tasks
- `POST /api/tasks` — create task with automatic 2-hour SLA
- `PATCH /api/tasks/:id` — update task text/category/status
- `DELETE /api/tasks/:id` — delete a task

Task endpoints require `Authorization: Bearer <token>`. Every task query is scoped to the authenticated user ID.

## Assignment scope / limitations

This is a deliberately simple assignment implementation, not a production identity system. It has basic email/password authentication and JWT sessions. It does **not** implement email verification, password reset, refresh tokens, rate limiting, or administrator roles. The token is stored in browser localStorage for simplicity; for a production app, prefer secure HttpOnly cookies and additional security controls. SLA countdown display is client-side, while task timestamps are set on the server.
