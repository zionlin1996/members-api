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
- **Member status** (`UNVERIFIED | ACTIVE | SUSPENDED`): new members are `UNVERIFIED` and **can log in**, but the `requireActive` middleware (`auth.middleware.js`) gates profile-detail getters (`GET /auth/me/profile`, `GET /auth/userinfo`) with `403 {message:'Account pending approval'}` until an admin calls `POST /admin/members/:id/approve` (→ `ACTIVE`). `GET /auth/me` stays open. Only `SUSPENDED` is rejected at login (`403 'Account suspended'`, enforced in each login service). `PATCH /auth/me/profile` is intentionally not status-gated (pending product decision).
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

## OIDC

There are **two** OIDC token systems, sharing one signing key but isolated by audience:

### First-party token issuer (the SPA's session)

Mints tokens through the custom `/auth/*` login endpoints and publishes the means to verify them.

- **Token signing**: access tokens and ID tokens are **RS256**, signed with the OIDC key pair (`src/utils/oidcKeys.js`). Refresh tokens and OAuth state tokens stay **HS256** (internal, never externally verified). The signing key comes from `OIDC_PRIVATE_KEY` (PEM or base64 PEM); if unset, an ephemeral key is generated at boot (dev only).
- **`kid`** is the RFC 7638 JWK thumbprint — stable for a given key, so first-party tokens and the Authorization Server share one published JWKS.
- **Login/refresh responses** include `idToken` alongside `accessToken` (the refresh token stays in the httpOnly cookie). Registration endpoints issue no tokens.
- **Claims** are defined once in `oidc.service.getClaims(member, profile, scopes)` — the single source of truth for first-party ID-token / `/auth/userinfo` claims **and** the Authorization Server's `findAccount` resolver. `sub` is the **immutable `Member.id`**; `email` is `{username}@EMAIL_DOMAIN`.
- **`auth.middleware`** verifies access tokens with the OIDC public key (RS256), asserting `iss === OIDC_ISSUER` **and `aud === OIDC_ISSUER`**. The `aud` check is the isolation guard (see below).

### Authorization Server — third-party clients (Phase 3, `src/oidc/`)

Built on **`node-oidc-provider` v9** (ESM-only → loaded via dynamic `import()` in `src/oidc/provider.js`; the codebase stays CommonJS). Serves **third-party** apps via **Authorization Code + PKCE**; the first-party SPA still uses the custom login above.

- **Mounting**: `provider.callback()` is a terminal Koa listener — it's mounted **last** in `app.js` as a lazy catch-all (initialized on first OIDC request), so the `/auth`,`/members`,`/admin`,`/interaction` routers handle their paths first and only OIDC routes fall through. The provider **owns** discovery + JWKS (the old hand-rolled `/.well-known/*` routes were removed; `/.well-known/jwks.json` 301s to `/jwks`).
- **Routes** are remapped to avoid colliding with first-party paths: authorization → `/authorize`, userinfo → `/userinfo` (defaults `/auth` and `/me` would clash). Also `/token`, `/jwks`, `/session/end`, `/token/{introspection,revocation}`.
- **Persistence**: a generic single-table Prisma adapter (`src/oidc/adapter.js`) over `OidcPayload` (composite PK `[type, id]`); `consume` marks `consumedAt` without deleting (replay detection). A `memory-adapter.js` is used for tests (`OIDC_ADAPTER=memory`).
- **Clients**: admin-managed registry `OAuthClient` (`/admin/oauth-clients`, `oauthClient.service.js`), loaded dynamically by a Client adapter. **Public + mandatory PKCE only** (`token_endpoint_auth_method: 'none'`) — the provider does plaintext secret comparison, so confidential clients with a stored `secretHash` are deferred.
- **Interaction**: login + consent are **dedicated SPA routes**. The provider redirects to `${APP_ORIGIN}/interaction/:uid`; the SPA calls the API's `/interaction/:uid` JSON endpoints (`interaction.controller.js`). The route prefix **must** be `/interaction` to match the provider's path-scoped `_interaction` cookie. The login step reuses the **authenticate-only seam** (`verifyPassword`/`verifyPasskeyAuthentication`/`verifyGoogle`/`verifyTelegram`) — verify credentials and enforce `SUSPENDED → 403` **without** minting a first-party session. Cross-site cookies are `SameSite=None; Secure` over HTTPS, falling back to `Lax`/insecure on http (dev).
- **Audience isolation**: third-party access tokens are **opaque** (consumed at the provider's `/userinfo`). They can't reach first-party endpoints because `auth.middleware` requires a valid RS256 JWT with `aud === OIDC_ISSUER`. `OIDC_API_RESOURCE` is reserved for future self-verifiable JWT tokens against a dedicated resource server.
- **Testing**: jest can't ESM-import the provider, so unit tests (adapter, interaction controller, client service, audience isolation) run under `yarn test`, and the full `/authorize→/token→/userinfo` flow runs standalone under `yarn test:oidc` (needs the local DB).
