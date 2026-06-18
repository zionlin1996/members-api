# CLAUDE.md

Guidelines and context for Claude Code working in this repository.

## Stack

- **Runtime**: Node.js 22+ (CommonJS, `'use strict'`)
- **Framework**: Express 4
- **ORM**: Prisma 5 with PostgreSQL
- **Auth**: JWT (jsonwebtoken) + bcryptjs + @simplewebauthn/server + passport-google-oauth20
- **Package manager**: Yarn (never use npm)

## Project Structure

```
src/
  server.js          # Entry point — connects DB, starts HTTP server
  app.js             # Express app — mounts routes and middleware
  config/
    env.js           # Validated env vars (throws on missing required vars)
    prisma.js        # Prisma singleton
  controllers/       # HTTP layer — parse req, call service, send res
  services/          # Business logic — all DB access lives here
    auth.service.js      # password register/login; token refresh/logout
    passkey.service.js   # WebAuthn registration and authentication ceremonies
    google.service.js    # Google OAuth token exchange and profile lookup
    telegram.service.js  # Telegram widget HMAC verification
    member.service.js    # CRUD on Member; exposes SAFE_SELECT
  middleware/
    auth.middleware.js     # authenticate() — verifies Bearer access token
    apiKey.middleware.js   # requireApiKey() — verifies Authorization: ApiKey header
    error.middleware.js    # Global error handler (last middleware in app.js)
  routes/            # Router files — wire controllers to paths
  utils/
    jwt.js           # sign/verify access and refresh tokens
    ms.js            # Duration string parser ("7d" → ms)
    username.js      # isValidUsername() — enforces email local-part rules
prisma/
  schema.prisma      # Source of truth for DB schema
```

## Key Conventions

- **Layer separation**: controllers handle HTTP only, services handle all logic and DB calls. Never put Prisma queries in controllers.
- **Credential model**: all auth methods store secrets and provider-specific data in `Credential.meta` (Json). Only `credentialId` (passkey lookup) and `providerId` (OAuth lookup) are first-class columns — they need indexed queries during authentication. Everything else (passwordHash, publicKey, backupEmail, etc.) lives in `meta`.
- **Username = email local-part**: `username` is the sole unique identifier. The member email is always `{username}@yangfrenz.club` — never stored, always computed. Validate with `isValidUsername()` at all registration, availability, and update endpoints.
- **backupEmail**: required in `Credential.meta` for `PASSWORD` and `PASSKEY` flows (recovery channel). Absent for `GOOGLE` and `TELEGRAM` (recovery goes through the provider).
- **Member status**: new members are `UNVERIFIED`. Login returns `403` until an admin calls `POST /admin/members/:id/approve` to set status to `ACTIVE`.
- **Admin auth**: `Authorization: ApiKey <ADMIN_API_KEY>` header, checked by `requireApiKey()` middleware. Admin routes are not member accounts.
- **Password handling**: always hash with bcryptjs before writing; never return `passwordHash` or any credential secret from any API response. Use `SAFE_SELECT` in member service for all queries.
- **Error propagation**: throw errors with a `.status` property from services; the global error handler in `error.middleware.js` maps `.status` to HTTP status codes.
- **Refresh tokens**: stored in the DB (`RefreshToken` table) and rotated on every use. Delivered as an httpOnly `refreshToken` cookie.
- **Access tokens**: short-lived Bearer tokens, verified in `auth.middleware.js`.
- **No controller-level Prisma**: all Prisma access must go through service files.
- **Env vars**: always add new env vars to both `src/config/env.js` (with validation) and `.env.example`.
- **Domain topology**: public hostnames are derived in `env.js` from three base vars — `DOMAIN`, `API_SUBDOMAIN`, `APP_SUBDOMAIN`. `CORS_ORIGIN`/`WEBAUTHN_ORIGIN` = `https://{APP_SUBDOMAIN}.{DOMAIN}`, `OIDC_ISSUER` = `https://{API_SUBDOMAIN}.{DOMAIN}`, `OIDC_CLIENT_ID` = `{APP_SUBDOMAIN}.{DOMAIN}`, `WEBAUTHN_RP_ID`/`EMAIL_DOMAIN` = `{DOMAIN}`. Production sets only the three base vars; each derived value stays overridable for local dev (where http/localhost/ports can't be derived).

## Running Locally

```bash
cp .env.example .env   # fill in DATABASE_URL, JWT secrets, and auth provider vars
yarn install
yarn db:migrate
yarn dev
```

## Database Changes

Always use migrations in development:

```bash
yarn db:migrate    # creates a migration file and applies it
yarn db:generate   # regenerate Prisma client after schema changes
```

Only use `yarn db:push` for quick prototyping — it skips migration history.

## Deployment

Deployed via CapRover using `captain-definition` + `Dockerfile`.

**Container startup sequence** (`scripts/start.sh`):
1. `node scripts/setup-db.js` — generates Prisma client + runs `prisma migrate deploy` (falls back to `db push`)
2. `yarn start` — starts the Express server

**Key deploy notes:**
- The container listens on port `80` (set via `ENV PORT=80` in Dockerfile)
- All env vars are injected by CapRover at runtime via **App Config → Environmental Variables** — do not bake secrets into the image
- `db:migrate:prod` uses `prisma migrate deploy` (not `migrate dev`) — applies existing migration files without creating new ones
- Always commit migration files generated by `yarn db:migrate` so they are available in the container

## Adding a New Route

1. Add the service method in `src/services/<entity>.service.js`
2. Add the controller handler in `src/controllers/<entity>.controller.js`
3. Add the route in `src/routes/<entity>.routes.js`
4. Mount the router in `src/app.js`

## Auth Architecture

Registration is two-step from the UX perspective:
1. User enters display name → **frontend** derives `username` (e.g. `yang.lin`) and optionally checks `GET /auth/availability`. No backend call needed.
2. User picks an auth method and submits to the appropriate `/auth/register/*` endpoint.

Each registration endpoint creates one `Member` (status `UNVERIFIED`) and one `Credential` of the matching type. Login endpoints look up the `Credential` first, then the `Member`.

WebAuthn ceremonies are stateless between requests — the challenge is stored in `PendingChallenge` with a 5-minute TTL. The `sessionId` returned by `/start` endpoints is the `PendingChallenge.id`.

## OIDC issuer

This API is an OIDC **token issuer** (not yet a full authorization server — there is no `/authorize`/`/token`). It mints tokens through its own login endpoints and publishes the means to verify them.

- **Token signing**: access tokens and ID tokens are **RS256**, signed with the OIDC key pair (`src/utils/oidcKeys.js`). Refresh tokens and OAuth state tokens stay **HS256** (internal, never externally verified). The signing key comes from `OIDC_PRIVATE_KEY` (PEM or base64 PEM); if unset, an ephemeral key is generated at boot (dev only).
- **`kid`** is the RFC 7638 JWK thumbprint — stable for a given key, so it survives a future migration to a full authorization server.
- **Login/refresh responses** now include `idToken` alongside `accessToken` (the refresh token stays in the httpOnly cookie). Registration endpoints issue no tokens.
- **Claims** are defined once in `oidc.service.getClaims()` — the single source of truth for ID-token and `/userinfo` claims. `sub` is the **immutable `Member.id`** (never `username`, which can change). `email` is computed as `{username}@EMAIL_DOMAIN`.
- **Endpoints**: `GET /.well-known/openid-configuration` (discovery), `GET /.well-known/jwks.json` (public keys), `GET /auth/userinfo` (Bearer-authenticated standard claims).
- **`auth.middleware`** verifies access tokens with the OIDC public key (RS256), checking `iss` and `aud`.
