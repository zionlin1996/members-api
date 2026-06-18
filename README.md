# members-api

REST API for member management with multi-method authentication. Built with Node.js, Express, Prisma, and PostgreSQL.

Members register with one of four auth methods (password, passkey/WebAuthn, Google OAuth, Telegram OAuth). New accounts start as `UNVERIFIED` and require admin approval before they can log in.

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
# Edit .env — see Environment Variables section below

# 3. Run database migrations
yarn db:migrate

# 4. Start the dev server
yarn dev
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | — | HS256 secret for OAuth **state** tokens (access tokens are RS256 — see OIDC) |
| `JWT_REFRESH_SECRET` | Yes | — | HS256 secret for signing refresh tokens |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Access + ID token TTL |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Refresh token TTL |
| `OIDC_ISSUER` | No | `http://localhost:$PORT` | Public base URL of the API; `iss` claim + discovery base |
| `OIDC_CLIENT_ID` | No | `members-web` | Audience (`aud`) of issued ID tokens |
| `OIDC_PRIVATE_KEY` | Prod | _(ephemeral)_ | RSA private key (PEM or base64 PEM) for RS256 access/ID tokens. If unset, generated at boot (dev only) |
| `EMAIL_DOMAIN` | No | `yangfrenz.club` | Domain used to compute member emails for claims |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Comma-separated browser origins allowed credentialed requests |
| `BCRYPT_ROUNDS` | No | `12` | bcrypt work factor |
| `PORT` | No | `3000` | HTTP port |
| `NODE_ENV` | No | `development` | Environment name |
| `WEBAUTHN_RP_ID` | Passkey | — | Relying party domain (e.g. `yangfrenz.club`) — must match the browser-visible domain exactly |
| `WEBAUTHN_RP_NAME` | Passkey | — | Human-readable app name shown by authenticators (e.g. `YangFrenz`) |
| `WEBAUTHN_ORIGIN` | Passkey | — | Full origin with protocol (e.g. `https://yangfrenz.club`) |
| `GOOGLE_CLIENT_ID` | Google | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google | — | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | Google | — | Full OAuth callback URL (e.g. `https://yangfrenz.club/api/auth/google/callback`) |
| `TELEGRAM_BOT_TOKEN` | Telegram | — | Telegram bot token for HMAC widget verification |
| `ADMIN_API_KEY` | Admin | — | Secret key protecting the admin approval endpoint |

## API

### Registration flow

Registration is a two-step UX:
1. User enters a display name → frontend derives `username` (e.g. `yang.lin`) — no API call needed.
2. User picks an auth method and submits. The account is created with status `UNVERIFIED`.

`username` rules: lowercase letters/digits, with dots, hyphens, or underscores as separators (e.g. `yang.lin`, `alice123`). Max 64 characters. This becomes the email local-part: `username@yangfrenz.club`.

#### Check availability

```
GET /auth/availability?username=yang.lin
```

Response:
```json
{ "username": { "available": true } }
```

#### Register — password

```
POST /auth/register/password
{ "displayName": "Yang Lin", "username": "yang.lin", "password": "...", "meta": { "backupEmail": "you@example.com" } }
```

`meta.backupEmail` is required — used for account recovery.

#### Register — passkey (WebAuthn)

Two-step ceremony:

```
POST /auth/register/passkey/start
{ "displayName": "Yang Lin", "username": "yang.lin", "backupEmail": "you@example.com" }
→ { "sessionId": "...", "options": { ...WebAuthn PublicKeyCredentialCreationOptions... } }

POST /auth/register/passkey/finish
{ "sessionId": "...", "credential": { ...WebAuthn response... } }
```

#### Register — Google OAuth

```
GET /auth/register/google?displayName=Yang+Lin&username=yang.lin
→ 302 redirect to Google consent screen

GET /auth/google/callback  (Google redirects here)
→ issues tokens
```

#### Register — Telegram

```
POST /auth/register/telegram
{ "displayName": "Yang Lin", "username": "yang.lin", "telegramData": { ...Telegram widget data... } }
```

### Login

#### Password

```
POST /auth/login
{ "username": "yang.lin", "password": "..." }
→ { "accessToken": "..." }  +  refreshToken httpOnly cookie
```

Returns `403` if the account is `UNVERIFIED`.

#### Passkey (WebAuthn)

```
POST /auth/login/passkey/start
{ "username": "yang.lin" }
→ { "sessionId": "...", "options": { ...WebAuthn PublicKeyCredentialRequestOptions... } }

POST /auth/login/passkey/finish
{ "sessionId": "...", "credential": { ...WebAuthn response... } }
→ { "accessToken": "..." }  +  refreshToken httpOnly cookie
```

#### Google OAuth

```
GET /auth/login/google
→ 302 redirect to Google consent screen

GET /auth/google/callback  (Google redirects here)
→ issues tokens
```

#### Telegram

```
POST /auth/login/telegram
{ "telegramData": { ...Telegram widget data... } }
→ { "accessToken": "...", "idToken": "..." }  +  refreshToken httpOnly cookie
```

All login endpoints (password, passkey, Google, Telegram) return `accessToken` (RS256) and `idToken` (OIDC) in the body, plus the refresh token in the httpOnly cookie.

### Token management

```
POST /auth/refresh     — rotate refresh token (reads httpOnly cookie); returns new accessToken + idToken
POST /auth/logout      — invalidate refresh token
GET  /auth/me          — return current member profile (requires Bearer token)
GET  /auth/userinfo    — OIDC standard claims for the bearer (requires Bearer token)
```

`GET /auth/me` response — a flat member object (no wrapper). The email is not
returned; derive it from `username` as `{username}@yangfrenz.club`:
```json
{ "id": "...", "displayName": "Yang Lin", "username": "yang.lin", "status": "UNVERIFIED", "createdAt": "...", "updatedAt": "..." }
```

### OIDC

This API issues OIDC-shaped tokens signed with an RS256 key it publishes (token issuer; no `/authorize` yet).

```
GET /.well-known/openid-configuration  — discovery document
GET /.well-known/jwks.json             — public signing keys (JWKS)
GET /auth/userinfo                     — standard claims (Bearer)
```

`GET /auth/userinfo` response:
```json
{ "sub": "<member-id>", "name": "Yang Lin", "preferred_username": "yang.lin", "email": "yang.lin@yangfrenz.club", "email_verified": true, "updated_at": 1700000000 }
```

### Members

All member routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/members` | List all members |
| `GET` | `/members/:id` | Get a member by ID |
| `PATCH` | `/members/:id` | Update your own member (`displayName`, `username`) |

### Admin

All admin routes require `Authorization: ApiKey <ADMIN_API_KEY>`.

```
POST /admin/members/:id/approve
```

Sets member `status` from `UNVERIFIED` → `ACTIVE`. Includes placeholder hooks for:
- ProtonMail mailbox creation (`username@yangfrenz.club`)
- Recovery phrase delivery (to `meta.backupEmail` for password/passkey flows)

### Health

```
GET /health → { "status": "ok" }
```

## Token strategy

- **Access token** — short-lived (default 15m), **RS256** signed with the OIDC key, verifiable via the published JWKS. Sent as `Authorization: Bearer <token>`. Carries `iss` and `aud` (the API itself).
- **ID token** — OIDC identity token (RS256), returned by login/refresh. `aud` is `OIDC_CLIENT_ID`. Carries standard profile claims.
- **Refresh token** — long-lived (default 7d), HS256, stored in the `RefreshToken` table and delivered as an httpOnly `refreshToken` cookie. Rotated on every `/auth/refresh` call.

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Start with nodemon (hot reload) |
| `yarn start` | Start without hot reload |
| `yarn test` | Run Jest test suite |
| `yarn db:migrate` | Run Prisma migrations (dev) |
| `yarn db:migrate:prod` | Deploy migrations (production) |
| `yarn db:push` | Push schema without migration |
| `yarn db:generate` | Regenerate Prisma client |
| `yarn db:studio` | Open Prisma Studio |

## Deployment (CapRover)

The project includes a `captain-definition` and `Dockerfile` for CapRover deployment.

**Container startup flow:**
1. `scripts/start.sh` runs on container start
2. `scripts/setup-db.js` runs `prisma generate` + `prisma migrate deploy` (falls back to `db push` if no migrations exist)
3. App starts via `yarn start`

Set all env vars in CapRover's **App Config → Environmental Variables** panel — they are injected at runtime, no Dockerfile changes needed. The container listens on port `80`.

## Data model

```
Member
  id            UUID (PK)
  displayName   String
  username      String (unique) — email = username@yangfrenz.club (computed, not stored)
  status        UNVERIFIED | ACTIVE | SUSPENDED
  createdAt     DateTime
  updatedAt     DateTime

Credential  (one per auth method per member)
  id           UUID (PK)
  memberId     UUID (FK → Member, cascade delete)
  type         PASSWORD | PASSKEY | GOOGLE | TELEGRAM
  credentialId String? (unique) — passkey credential ID
  providerId   String?          — OAuth provider user ID
  meta         Json             — passwordHash, publicKey, backupEmail, etc.
  createdAt    DateTime

RefreshToken
  id        UUID (PK)
  token     String (unique)
  memberId  UUID (FK → Member, cascade delete)
  expiresAt DateTime
  createdAt DateTime

PendingChallenge  (WebAuthn ceremony state, 5-min TTL)
  id        UUID (PK)
  challenge String
  context   Json
  expiresAt DateTime
  createdAt DateTime
```
