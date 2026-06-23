# members-api

REST API for member management with multi-method authentication. Built with Node.js, Express, Prisma, and PostgreSQL.

Members register with one of four auth methods (password, passkey/WebAuthn, Google OAuth, Telegram OAuth). New accounts start as `UNVERIFIED`: they can log in but get a limited session (no profile details) until an admin approves them. See [Member status & limited session](#member-status--limited-session).

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

All public hostnames are **derived from three base variables**, so production only configures `DOMAIN`, `API_SUBDOMAIN`, and `APP_SUBDOMAIN`. Every domain-shaped value (CORS origin, WebAuthn RP/origin, OIDC issuer/audience, email domain) is computed from them — each still overridable by its own env var, which is required for local dev (http + localhost + ports can't be derived from a domain).

| Variable                 | Required | Default                            | Description                                                                                                 |
| ------------------------ | -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                 | No       | `yangfrenz.club`                   | Root domain; base for all derived hostnames                                                                 |
| `API_SUBDOMAIN`          | No       | `members-api`                      | API host = `{API_SUBDOMAIN}.{DOMAIN}`                                                                       |
| `APP_SUBDOMAIN`          | No       | `members`                          | App (SPA) host = `{APP_SUBDOMAIN}.{DOMAIN}`                                                                 |
| `DATABASE_URL`           | Yes      | —                                  | PostgreSQL connection string                                                                                |
| `JWT_ACCESS_SECRET`      | Yes      | —                                  | HS256 secret for OAuth **state** tokens (access tokens are RS256 — see OIDC)                                |
| `JWT_REFRESH_SECRET`     | Yes      | —                                  | HS256 secret for signing refresh tokens                                                                     |
| `JWT_ACCESS_EXPIRES_IN`  | No       | `15m`                              | Access + ID token TTL                                                                                       |
| `JWT_REFRESH_EXPIRES_IN` | No       | `7d`                               | Refresh token TTL                                                                                           |
| `OIDC_PRIVATE_KEY`       | Prod     | _(ephemeral)_                      | RSA private key (PEM or base64 PEM) for RS256 access/ID tokens. If unset, generated at boot (dev only)      |
| `OIDC_ISSUER`            | Derived  | `https://{API_SUBDOMAIN}.{DOMAIN}` | Public base URL of the API; `iss` claim + discovery base. Override in dev → `http://localhost:3000`         |
| `OIDC_CLIENT_ID`         | Derived  | `{APP_SUBDOMAIN}.{DOMAIN}`         | Audience (`aud`) of issued ID tokens                                                                        |
| `OIDC_COOKIE_KEYS`       | Prod     | `JWT_ACCESS_SECRET`                | Comma-separated secrets signing the AS interaction/session cookies (rotate by prepending)                   |
| `OIDC_API_RESOURCE`      | Derived  | `{OIDC_ISSUER}/api`                | Reserved audience for future self-verifiable JWT resource-server tokens; must differ from `OIDC_ISSUER`     |
| `OIDC_ADAPTER`           | No       | `prisma`                           | AS persistence adapter — `prisma` or `memory` (tests only)                                                  |
| `EMAIL_DOMAIN`           | Derived  | `{DOMAIN}`                         | Domain used to compute member emails for claims                                                             |
| `CORS_ORIGIN`            | Derived  | `https://{APP_SUBDOMAIN}.{DOMAIN}` | Comma-separated browser origins allowed credentialed requests. Override in dev                              |
| `WEBAUTHN_RP_ID`         | Derived  | `{DOMAIN}`                         | Relying party domain — must match the browser-visible domain. Override in dev → `localhost`                 |
| `WEBAUTHN_ORIGIN`        | Derived  | `https://{APP_SUBDOMAIN}.{DOMAIN}` | Full app origin with protocol. Override in dev                                                              |
| `WEBAUTHN_RP_NAME`       | Passkey  | —                                  | Human-readable app name shown by authenticators (e.g. `YangFrenz`)                                          |
| `BCRYPT_ROUNDS`          | No       | `12`                               | bcrypt work factor                                                                                          |
| `PORT`                   | No       | `3000`                             | HTTP port                                                                                                   |
| `NODE_ENV`               | No       | `development`                      | Environment name                                                                                            |
| `GOOGLE_CLIENT_ID`       | Google   | —                                  | Google OAuth client ID                                                                                      |
| `GOOGLE_CLIENT_SECRET`   | Google   | —                                  | Google OAuth client secret                                                                                  |
| `GOOGLE_CALLBACK_URL`    | Derived  | `{API_BASE}/auth/google/callback`  | OAuth callback; derived from the API base URL (follows `OIDC_ISSUER` in dev). Must match the Google console |
| `TELEGRAM_BOT_TOKEN`     | Telegram | —                                  | Telegram bot token for HMAC widget verification                                                             |
| `ADMIN_API_KEY`          | Admin    | —                                  | Secret key protecting the admin approval endpoint                                                           |

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

Returns `403` only if the account is `SUSPENDED`. `UNVERIFIED` members **may** log in and receive a session, but it is limited — the profile-detail getters (`GET /auth/me/profile`, `GET /auth/userinfo`) return `403` until an admin approves the account. See [Member status & limited session](#member-status--limited-session).

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
{
  "id": "...",
  "displayName": "Yang Lin",
  "username": "yang.lin",
  "status": "UNVERIFIED",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Profile (self-service)

Extended profile fields, modeled on OIDC standard claims. Both require a Bearer token and operate on the **current member** (no `:id`):

```
GET   /auth/me/profile   — current member's profile (flat; all-null if not yet set)
PATCH /auth/me/profile   — update own profile (partial; send only changed fields)
```

Updatable fields: `givenName, familyName, middleName, nickname, birthdate (YYYY-MM-DD), gender, pronouns, locale (BCP-47), zoneinfo (IANA tz), picture, website, profileUrl, phoneNumber (E.164), streetAddress, locality, region, postalCode, country (ISO 3166-1 alpha-2)`. Send `null`/`""` to clear a field. `phoneVerified` and timestamps are system-managed. Invalid fields return `400`.

`GET /auth/me/profile` returns `403 {"message":"Account pending approval"}` for non-`ACTIVE` members (see [Member status & limited session](#member-status--limited-session)). `PATCH` is not status-gated.

### Member status & limited session

A member's `status` is `UNVERIFIED | ACTIVE | SUSPENDED`.

- **`UNVERIFIED`** (new accounts): may log in and hold a session, but profile-detail getters are blocked. A `requireActive` middleware (`src/middleware/auth.middleware.js`) gates `GET /auth/me/profile` and `GET /auth/userinfo`, returning `403 {"message":"Account pending approval"}`. `GET /auth/me` stays open so clients can read `status` and show a pending-approval view.
- **`ACTIVE`** (admin-approved via `POST /admin/members/:id/approve`): full access.
- **`SUSPENDED`**: denied at login with `403 {"message":"Account suspended"}` across all four auth methods.

### OIDC

This API issues OIDC-shaped tokens signed with an RS256 key it publishes, and is a full **OIDC Authorization Server** for third-party apps (Authorization Code + PKCE).

**First-party (the SPA's session)** — tokens minted by the `/auth/*` login endpoints; `GET /auth/userinfo` returns standard claims for the logged-in member (Bearer):

```json
{
  "sub": "<member-id>",
  "name": "Yang Lin",
  "preferred_username": "yang.lin",
  "email": "yang.lin@yangfrenz.club",
  "email_verified": true,
  "updated_at": 1700000000
}
```

**Authorization Server (third-party clients)** — served by `node-oidc-provider`, sharing the same signing key/JWKS:

```
GET  /.well-known/openid-configuration  — discovery document
GET  /jwks                              — public signing keys (JWKS); /.well-known/jwks.json 301s here
GET  /authorize                         — Authorization Code + PKCE (PKCE required) → redirects to SPA /interaction/:uid
POST /token                             — code → tokens (public client; no secret)
GET  /userinfo                          — third-party claims (opaque access token; scope-gated)
     /session/end, /token/introspection, /token/revocation
```

Clients are **public + PKCE** (no client secret) and admin-registered (see Admin → OAuth clients). Login and consent are rendered by dedicated SPA routes that call the interaction API below. Third-party access tokens are opaque and **cannot** be used on first-party (`/auth/*`, `/members/*`) endpoints — those require a first-party RS256 JWT (`aud = OIDC_ISSUER`).

#### OIDC interaction (login + consent)

The SPA's `/interaction/:uid` route drives these (all credentialed; the provider's interaction cookie must ride along):

```
GET  /interaction/:uid          — { uid, prompt: "login"|"consent", client, requestedScopes, missingScopes, missingClaims }
POST /interaction/:uid/login    — { method: "password"|"passkey"|"telegram"|"google", ... } → { redirectTo }
POST /interaction/:uid/consent  — (empty body) → { redirectTo }
```

### Members

All member routes require `Authorization: Bearer <accessToken>`.

| Method  | Path           | Description                                        |
| ------- | -------------- | -------------------------------------------------- |
| `GET`   | `/members`     | List all members                                   |
| `GET`   | `/members/:id` | Get a member by ID                                 |
| `PATCH` | `/members/:id` | Update your own member (`displayName`, `username`) |

### Admin

All admin routes require `Authorization: ApiKey <ADMIN_API_KEY>`.

```
POST /admin/members/:id/approve
```

Sets member `status` from `UNVERIFIED` → `ACTIVE`. Includes placeholder hooks for:

- ProtonMail mailbox creation (`username@yangfrenz.club`)
- Recovery phrase delivery (to `meta.backupEmail` for password/passkey flows)

#### OAuth client registry (Authorization Server)

```
POST   /admin/oauth-clients       — register a public PKCE client { name, redirectUris[], allowedScopes[], clientId?, logoUri? }
GET    /admin/oauth-clients       — list clients
GET    /admin/oauth-clients/:id   — get a client
PATCH  /admin/oauth-clients/:id   — update (name, redirectUris, allowedScopes, logoUri)
DELETE /admin/oauth-clients/:id   — remove
```

`allowedScopes` must include `openid` (subset of `openid profile email address phone membership offline_access`); redirect URIs must be `https` (or `localhost`). Responses never include the client secret.

### Health

```
GET /health → { "status": "ok" }
```

## Token strategy

- **Access token** — short-lived (default 15m), **RS256** signed with the OIDC key, verifiable via the published JWKS. Sent as `Authorization: Bearer <token>`. Carries `iss` and `aud` (the API itself).
- **ID token** — OIDC identity token (RS256), returned by login/refresh. `aud` is `OIDC_CLIENT_ID`. Carries standard profile claims.
- **Refresh token** — long-lived (default 7d), HS256, stored in the `RefreshToken` table and delivered as an httpOnly `refreshToken` cookie. Rotated on every `/auth/refresh` call.

## Scripts

| Command                | Description                     |
| ---------------------- | ------------------------------- |
| `yarn dev`             | Start with nodemon (hot reload) |
| `yarn start`           | Start without hot reload        |
| `yarn test`            | Run Jest test suite             |
| `yarn db:migrate`      | Run Prisma migrations (dev)     |
| `yarn db:migrate:prod` | Deploy migrations (production)  |
| `yarn db:push`         | Push schema without migration   |
| `yarn db:generate`     | Regenerate Prisma client        |
| `yarn db:studio`       | Open Prisma Studio              |

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
