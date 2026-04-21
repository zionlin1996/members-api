# members-api

REST API for member management with JWT-based authentication. Built with Node.js, Express, Prisma, and PostgreSQL.

## Prerequisites

- Node.js 22+ (LTS)
- Yarn
- PostgreSQL

## Setup

```bash
# 1. Install dependencies
yarn install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT secrets

# 3. Run database migrations
yarn db:migrate

# 4. Start the dev server
yarn dev
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes | — | Secret for signing refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |
| `BCRYPT_ROUNDS` | No | `12` | bcrypt work factor |
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | `development` | Environment name |

## API

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/auth/register` | `username`, `password`, `assignedEmail`, `backupEmail?` | Register a new member |
| `POST` | `/auth/login` | `username`, `password` | Login — returns `accessToken`, sets `refreshToken` cookie |
| `POST` | `/auth/refresh` | — | Rotate refresh token (reads httpOnly cookie) |
| `POST` | `/auth/logout` | — | Invalidate refresh token |

### Members

All member routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/members` | List all members |
| `GET` | `/members/:id` | Get a member by ID |
| `PATCH` | `/members/:id` | Update a member (`username`, `password`, `assignedEmail`, `backupEmail`) |
| `DELETE` | `/members/:id` | Delete a member |

### Health

```
GET /health → { "status": "ok" }
```

## Token Strategy

- **Access token** — short-lived (default 15m), sent as `Authorization: Bearer <token>` header.
- **Refresh token** — long-lived (default 7d), stored in the `RefreshToken` table and delivered as an httpOnly `refreshToken` cookie. Rotated on every `/auth/refresh` call.

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Start with nodemon (hot reload) |
| `yarn start` | Start without hot reload |
| `yarn db:migrate` | Run Prisma migrations (dev) |
| `yarn db:migrate:prod` | Deploy migrations (production) |
| `yarn db:push` | Push schema without migration |
| `yarn db:generate` | Regenerate Prisma client |
| `yarn db:studio` | Open Prisma Studio |

## Deployment (CapRover)

The project includes a `captain-definition` and `Dockerfile` for CapRover deployment.

**Container startup flow:**
1. `scripts/start.sh` runs on container start
2. `scripts/setup-db.js` runs `prisma generate` + `prisma migrate deploy` (falls back to `db push` if no migrations exist yet)
3. App starts via `yarn start`

**Environment variables** are passed as CapRover app env vars — see `.env.example` for the full list. The `PORT` is fixed to `80` inside the container.

## Data Model

```
Member
  id            UUID (PK)
  username      String (unique)
  password      String (bcrypt hash)
  assignedEmail String (unique)
  backupEmail   String? (optional)
  createdAt     DateTime
  updatedAt     DateTime

RefreshToken
  id        UUID (PK)
  token     String (unique)
  memberId  UUID (FK → Member, cascade delete)
  expiresAt DateTime
  createdAt DateTime
```
