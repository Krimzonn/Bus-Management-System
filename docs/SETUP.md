# Setup — running and testing locally

Requires Node.js `^20.19` or `>=22.12` and PostgreSQL 16.

## 1. Backend (needed by the frontend)

```bash
cd server
npm install
cp .env.example .env        # then edit the values
npm run migrate
npm run dev                 # http://localhost:5000
```

`server/.env` (never commit it) needs:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | Backend port. The frontend dev proxy expects `5000` |
| `SESSION_SECRET` | Long random string used to sign the session cookie. **Not yet listed in `server/.env.example`** |

### First Admin account

Create the first account once:

```bash
cd server
BOOTSTRAP_EMAIL=you@example.com BOOTSTRAP_PASSWORD='at-least-12-characters' npm run bootstrap:user
```

The account is created **without a role**. Migration `005` only gives the Admin role to an account that already exists when the migration runs, so a bootstrap account created afterwards cannot manage accounts. Until the backend handles this, assign the role once in `psql`:

```sql
UPDATE iam_users
SET role_id = (SELECT id FROM iam_roles WHERE role_key = 'admin')
WHERE email = 'you@example.com';
```

## 2. Frontend

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

The Vite dev server forwards `/api` to `http://localhost:5000` (see `client/vite.config.js`), so the browser and the API share one origin and the session cookie works without extra CORS setup. `client/.env.example` only needs `VITE_API_BASE_URL=/api/v1`.

Frontend checks:

```bash
npm run lint
npm run build
```

## 3. Manual test checklist (Slice 2 frontend)

1. Open `http://localhost:5173` while signed out: the login page appears.
2. Sign in with a wrong password: "Incorrect email or password."
3. Sign in as Admin: the Welcome page shows your email and role, and an **Accounts** tab appears.
4. Refresh the page: you stay signed in.
5. Accounts: create an account, change its email, assign a role, deactivate and reactivate it. Each shows a success or error message.
6. Your own row: role change and deactivation are disabled.
7. Sign out: you return to the login page, and a refresh keeps you signed out.
8. Sign in as a non-Admin user: there is no **Accounts** tab (the backend also rejects direct calls with 403).
