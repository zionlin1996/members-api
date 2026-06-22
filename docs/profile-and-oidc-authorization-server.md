# Spec — Member Profiles & OIDC Authorization Server

Status: **Implemented through Phase 3 (backend)** — Phases 1–2 (profiles, scope-gated claims) and Phase 3 (third-party Authorization Server) are built. See `CLAUDE.md → OIDC` for the as-built description and `PLAN.md` for status + the FE `/interaction` handoff.
Scope: `members-api`. Builds on the existing OIDC **token issuer** (see `CLAUDE.md → OIDC`).

**Deviations from this spec made during Phase 3 implementation (the spec below is the original design):**

- **`OidcPayload` uses a composite PK `@@id([type, id])`**, not `id @id` — one `id` value can recur across provider models in a single-table adapter.
- **Third-party clients are public + mandatory PKCE only** (`token_endpoint_auth_method: 'none'`). `node-oidc-provider` compares client secrets in plaintext, so confidential clients with a hashed secret (`OAuthClient.secretHash`/`isConfidential`, retained for the future) are **not** served yet.
- **Third-party access tokens are opaque**, consumed at the provider's `/userinfo`. Forcing JWT resource-bound tokens (`features.resourceIndicators`, §4.1) broke `/userinfo` (it rejects resource-exclusive tokens), and there is no separate resource server yet. Audience isolation still holds (opaque ≠ first-party RS256 JWT). `OIDC_API_RESOURCE` is reserved for when a resource server exists.
- **Provider routes remapped** to avoid first-party collisions: authorization `/authorize` (default `/auth`), userinfo `/userinfo` (default `/me`).
- **First-party SPA was NOT migrated** to be an OIDC client (deferred); it keeps the custom cookie/BFF-lite login. The two systems coexist by audience.
- **Provider is mounted as a lazy catch-all** (ESM dynamic `import()`), so the app/server stayed synchronous.

## Goals

1. Store richer member profile data (DOB, gender, address, language, …) in the membership system.
2. Let members grant **third-party applications** scoped access to that data via the **standard OAuth 2.0 / OIDC Authorization Code + PKCE** flow with explicit consent.

Design principle: model profile fields on **OIDC standard claims**, so "share via OAuth" reduces to a scope → claim mapping rather than bespoke sharing logic.

Decisions locked:

- Profile data lives in a **separate `Profile` table** (1:1 with `Member`).
- The authorization server is built on **[`panva/node-oidc-provider`](https://github.com/panva/node-oidc-provider)** (certified), not hand-rolled.
- The first-party SPA keeps its current cookie / BFF-lite flow; the AS serves **third parties only** (initially).

---

## 1. Data model

### 1.1 `Profile` (1:1 with `Member`)

```prisma
model Member {
  // … existing fields …
  profile Profile?
}

model Profile {
  id            String    @id @default(uuid())
  memberId      String    @unique
  member        Member    @relation(fields: [memberId], references: [id], onDelete: Cascade)

  givenName     String?
  familyName    String?
  nickname      String?
  birthdate     DateTime? // date only; rendered YYYY-MM-DD
  gender        String?   // OIDC: free-form string
  locale        String?   // BCP-47, e.g. en-US
  zoneinfo      String?   // IANA tz, e.g. Europe/Zurich
  phoneNumber   String?   // E.164
  phoneVerified Boolean   @default(false)
  picture       String?   // URL
  website       String?

  // OIDC `address` claim — stored as columns, assembled into a JSON claim
  streetAddress String?
  locality      String?
  region        String?
  postalCode    String?
  country       String?   // ISO 3166-1 alpha-2

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

- Migration is additive (new table, all-nullable) — no backfill; members have no `Profile` row until they populate it.
- `gender`: stored as a free-form string per the OIDC spec (UI offers suggestions: male / female / non-binary / prefer-not-to-say / self-describe). Not a rigid enum.
- `address`: structured columns (queryable, validatable), assembled into the OIDC `address` JSON object (`formatted`, `street_address`, `locality`, `region`, `postal_code`, `country`).

### 1.2 Authorization-server persistence

`node-oidc-provider` needs a persistence Adapter. Use the common single-table generic adapter:

```prisma
model OidcPayload {
  id        String   @id            // model id
  type      String                  // "Session" | "Grant" | "AccessToken" | "AuthorizationCode" | "RefreshToken" | "Interaction" | …
  payload   Json
  grantId   String?
  userCode  String?
  uid       String?  @unique
  expiresAt DateTime?
  consumedAt DateTime?

  @@index([grantId])
  @@index([type])
}

model OAuthClient {
  id            String   @id @default(uuid())
  clientId      String   @unique
  name          String
  secretHash    String?              // null for public (PKCE-only) clients
  redirectUris  String[]
  allowedScopes String[]             // subset of supported scopes
  isConfidential Boolean @default(false)
  createdAt     DateTime @default(now())
}
```

- The Adapter maps the provider's `upsert/find/findByUid/findByUserCode/consume/destroy/revokeByGrantId` onto `OidcPayload`.
- `OAuthClient` is the third-party app registry (admin-managed). Public SPAs/native apps are PKCE-only (no secret); server-side apps are confidential.
- **Connected apps** (for the member-facing list) are derived from provider `Grant` records keyed by `grantId` + `accountId`.

---

## 2. Scopes & claims

| Scope                 | Claims released                                                                                                                  | Source                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `openid`              | `sub`                                                                                                                            | `Member.id`                                      |
| `profile`             | `name, given_name, family_name, nickname, preferred_username, picture, website, gender, birthdate, zoneinfo, locale, updated_at` | Member + Profile                                 |
| `email`               | `email, email_verified`                                                                                                          | derived (`{username}@DOMAIN`, `status===ACTIVE`) |
| `address`             | `address` (JSON object)                                                                                                          | Profile address columns                          |
| `phone`               | `phone_number, phone_number_verified`                                                                                            | Profile                                          |
| `membership` (custom) | `https://yangfrenz.club/membership_status`, `…/member_since`                                                                     | Member.status, createdAt                         |

- First four scopes are **OIDC standard** — interoperable with any OIDC client.
- Membership-specific data uses a **custom `membership` scope** with namespaced claim URIs (avoids colliding with standard claims).
- **Default deny**: a claim is released only if its scope was granted in the consent for that client.

### 2.1 Shared claims resolver

Refactor the existing `oidc.service.getClaims(member)` →

```
getClaims(member, profile, grantedScopes) → { …only claims for granted scopes }
```

This single function backs:

- the provider's `findAccount(ctx, sub).claims(use, scope, claims, rejected)` resolver, and
- first-party `/auth/userinfo` (called with the full first-party scope set).

`birthdate` is formatted `YYYY-MM-DD`; `address` is assembled into the OIDC object; `updated_at` is `Profile.updatedAt` epoch seconds.

---

## 3. Self-service profile API (first-party)

| Method  | Path          | Description                                                                                              |
| ------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `GET`   | `/me/profile` | Current member's full profile (flat)                                                                     |
| `PATCH` | `/me/profile` | Update own profile; per-field validation; ownership-guarded (same pattern as `member.controller.update`) |

`displayName` / `username` stay on the existing member-update path. Validation: birthdate (valid past date), `locale` (BCP-47), `country` (ISO 3166-1 alpha-2), `phoneNumber` (E.164), URLs for picture/website.

---

## 4. Authorization server (`node-oidc-provider`)

### 4.1 Configuration outline

```
new Provider(env.OIDC_ISSUER, {
  adapter: PrismaAdapter,            // OidcPayload-backed
  clients: loadFromOAuthClient(),    // or DB adapter for clients
  jwks: { keys: [oidcKeys.privateJwk] },   // SAME key as Path 1 → one JWKS
  scopes: ['openid','profile','email','address','phone','membership','offline_access'],
  claims: { profile:[…], email:[…], address:['address'], phone:[…], membership:[…] },
  findAccount: (ctx, sub) => ({ accountId: sub, claims: (use, scope) => getClaims(member, profile, scope.split(' ')) }),
  features: {
    devInteractions: { enabled: false },
    resourceIndicators: …,           // JWT access tokens for resource servers
    revocation: { enabled: true },
    introspection: { enabled: true },
  },
  formats: { AccessToken: 'jwt' },   // verifiable via JWKS
  pkce: { required: () => true },    // PKCE mandatory
  cookies: { keys: [...] },
  interactions: { url: (ctx, i) => `/interaction/${i.uid}` },
})
```

### 4.2 Endpoints (provider-owned, under the issuer)

`/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/authorize`, `/token`, `/userinfo`, `/token/introspection`, `/token/revocation`, `/session/end`.

> The provider's discovery + JWKS **replace** the hand-rolled Path-1 endpoints (`oidc.controller`/`oidc.routes`). The design (issuer URL, `kid`, key) carries over unchanged — only the plumbing is swapped, exactly as anticipated when Path 1 was chosen.

### 4.3 Interaction (login + consent)

- The provider redirects to `/interaction/:uid`.
- **Login step**: reuse existing `auth.service` / `passkey` / `google` / `telegram` flows to authenticate the member, then `provider.interactionFinished` with the login result.
- **Consent step**: render the requested client + scopes; on approval persist the Grant (provider `Grant` API) with the approved scopes.
- Interaction screens can be minimal server-rendered pages or delegate to dedicated SPA routes — TBD in implementation.

### 4.4 Coexistence with first-party tokens (important)

Two issuance systems share keys but stay isolated by **audience**:

- First-party access tokens: `aud = OIDC_ISSUER` (the API). `auth.middleware` accepts only these.
- Third-party access tokens (provider): `aud =` the client / resource indicator. Resource endpoints validate scope and reject member-only endpoints.

This prevents a scoped third-party token from reaching first-party member endpoints. `auth.middleware` must continue to assert `aud === OIDC_ISSUER`.

---

## 5. Consent, connected apps & governance

| Method   | Path                        | Description                                                 |
| -------- | --------------------------- | ----------------------------------------------------------- |
| `GET`    | `/me/connections`           | Third-party apps the member has authorized + granted scopes |
| `DELETE` | `/me/connections/:clientId` | Revoke a client's grant + its tokens                        |

- **Consent records**: persisted via provider Grants (scopes + timestamp); revocable.
- **Data minimization**: default deny; only granted-scope claims released.
- **PII at rest**: evaluate column encryption for `birthdate` / address / `phoneNumber` (or DB-level TDE); add an audit log of third-party claim releases.
- **GDPR**: export via `/me/profile`; erasure via member delete (Profile cascades). Consent versioning for ToS changes.

---

## 6. Testing strategy

- Profile CRUD: validation, ownership (403), nullable handling.
- `getClaims` scope filtering: each scope releases exactly its claims; ungranted scopes omitted.
- AS flow (integration): `/authorize` → interaction (login + consent) → code → `/token` (PKCE) → `/userinfo` returns only granted claims; refresh; revocation.
- Audience isolation: a third-party access token is rejected by `/members/*` and `/me/*`.
- Adapter: upsert/find/consume/revokeByGrantId round-trips.

---

## 7. Rollout phases

| Phase | Deliverable                                                                                                                            | Acceptance                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1     | `Profile` model + migration + `/me/profile` CRUD + validation                                                                          | Members can read/update profile; tests green             |
| 2     | Scope-aware `getClaims`; `/userinfo` + ID token honor scopes (first-party)                                                             | Claims gated by scope                                    |
| 3     | `node-oidc-provider` + Prisma adapter + client registry + login/consent interactions; discovery/JWKS switched to provider (shared key) | Third party completes auth-code+PKCE; gets scoped claims |
| 4     | Consent UI + `/me/connections` management + revocation                                                                                 | Members view/revoke connected apps                       |
| 5     | Hardening: PII encryption, audit log, rate limits, security review                                                                     | Sign-off                                                 |

Phases 1–2 ship richer profiles with no AS complexity; 3–5 add third-party sharing.

---

## 8. Open implementation sub-decisions

- Interaction UI: server-rendered minimal pages vs dedicated SPA consent routes.
- Whether to encrypt PII columns in Phase 1 or defer to Phase 5.
- Custom `membership` scope claim set (status, member_since, tier?).
- Eventually migrating the first-party SPA to be an OIDC client of our own AS (drops the dual-token coexistence) — deferred.

```

```
