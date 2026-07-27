# tossit.sh — Build Plan

> Toss a big file, get a link, send the link. That's the whole product.

## 1. What we're building

A private, single-owner file-sharing app for sending files too large for email, without
touching Google Drive or iCloud.

**Core loop**

1. Michael signs in with a passkey.
2. Drags a file (or several) onto the page.
3. Gets back an unguessable link like `https://tossit.sh/d/8fQ2xR7mKp3wZ1nYtV4bL9`.
4. Recipient opens the link in any browser and downloads. No account, no permissions, no login.

**Secondary loop — other people uploading to me**

- **One-time upload invite** — I send someone a link, they upload one file, the invite burns.
  No account, no email required.
- **Account invite** — they enter their email, get a 6-digit OTP, verify, register a passkey,
  and can upload whenever.

**Explicit non-goals** (do not build these unless asked)

- Folders, nesting, or a file browser for recipients
- Sharing permissions, ACLs, per-recipient access control
- File previews/thumbnails (maybe later for images)
- Versioning, comments, collaboration
- Mobile apps
- Backwards compatibility with anything (see global CLAUDE.md — clean breaks are the default)

## 2. Stack decision

Everything lives on Cloudflare, because the domain and the bucket already do.

| Concern      | Choice                                              | Why |
| ------------ | --------------------------------------------------- | --- |
| Framework    | React Router v7 (framework mode), SSR               | Loaders/actions map cleanly onto this app; Michael knows it cold |
| Runtime      | Cloudflare Workers                                  | Same account as the domain and R2; no cold-start tax; free tier covers this easily |
| Storage      | R2 bucket (`files.tossit.sh` already provisioned)   | Zero egress fees — the single most important property for a file-sharing app |
| Database     | D1 (SQLite) + Drizzle ORM                           | Tiny relational dataset; migrations via `drizzle-kit`; bound directly to the Worker |
| Auth         | Passkeys via `@simplewebauthn/server` + `/browser`  | No passwords to leak. WebCrypto-based, runs on Workers |
| Sessions     | Signed HTTP-only cookie → `sessions` row in D1      | Simple, revocable |
| Email (OTP)  | Resend                                              | One transactional template; cheap; good DX |
| Styling      | Tailwind v4                                         | Fast, and this UI is small |
| Package mgr  | bun                                                 | Per global CLAUDE.md |

**Fallback if Workers fight us:** the same app runs on Railway (Michael has the Railway MCP
configured) with Postgres instead of D1, still using R2 over the S3 API. Don't reach for this
unless something is genuinely blocked — Cloudflare is the better fit here.

### The one architectural decision that matters

**Never proxy an upload through the Worker.** Workers cap request bodies at 100 MB (free) /
200 MB (paid), and this app exists specifically for files bigger than that. So:

- **Uploads** go **browser → R2 directly**, using **presigned S3 multipart URLs** that the
  Worker mints. The Worker only ever sees metadata.
- **Downloads** stream **R2 → Worker → browser** via the R2 binding. Worker streaming has no
  response size cap, and routing downloads through the app is what lets us enforce expiry,
  download counts, and revocation. Support `Range` requests so resumable/partial downloads work.

Keep the R2 bucket **private**. `files.tossit.sh` is useful as the S3-compatible endpoint alias
for presigning; it should not be a public-read custom domain, or every access control below
becomes decorative.

## 3. Data model

```
users
  id            text pk            -- nanoid
  email         text unique not null
  name          text
  role          text not null      -- 'owner' | 'member'
  created_at    integer not null

credentials                        -- WebAuthn / passkeys
  id            text pk            -- credential ID (base64url)
  user_id       text not null fk -> users.id
  public_key    blob not null
  counter       integer not null
  transports    text               -- json array
  device_type   text               -- 'singleDevice' | 'multiDevice'
  backed_up     integer not null
  nickname      text               -- "MacBook Touch ID"
  created_at    integer not null
  last_used_at  integer

sessions
  id            text pk            -- opaque, 32 random bytes
  user_id       text not null fk -> users.id
  user_agent    text
  created_at    integer not null
  expires_at    integer not null
  revoked_at    integer

webauthn_challenges                -- short-lived, keyed by session-less cookie or email
  id            text pk
  challenge     text not null
  kind          text not null      -- 'registration' | 'authentication'
  email         text
  expires_at    integer not null

invites
  id            text pk
  code          text unique not null   -- 128-bit random, url-safe
  kind          text not null          -- 'upload' | 'account'
  label         text                   -- "Dave from the podcast" — for my own memory
  email         text                   -- optional pre-fill / restriction for 'account'
  max_uploads   integer                -- for 'upload' invites; default 1
  uses          integer not null default 0
  created_by    text not null fk -> users.id
  created_at    integer not null
  expires_at    integer                -- default: created_at + 7 days
  claimed_at    integer
  claimed_by    text fk -> users.id    -- set when an 'account' invite becomes a user
  revoked_at    integer

otp_codes
  id            text pk
  email         text not null
  code_hash     text not null          -- SHA-256, never store the plaintext code
  invite_id     text fk -> invites.id
  attempts      integer not null default 0
  expires_at    integer not null       -- now + 10 min
  consumed_at   integer

files
  id             text pk
  slug           text unique not null  -- the public link token, see §4
  r2_key         text not null         -- `${id}/${sanitizedFilename}`
  filename       text not null         -- original name, shown on download page
  content_type   text
  size           integer               -- bytes; null until upload completes
  status         text not null         -- 'pending' | 'complete' | 'aborted'
  multipart_id   text                  -- R2 uploadId while in flight
  uploaded_by    text fk -> users.id   -- null for anonymous invite uploads
  invite_id      text fk -> invites.id
  created_at     integer not null
  completed_at   integer
  expires_at     integer               -- null = never
  max_downloads  integer               -- null = unlimited
  download_count integer not null default 0
  deleted_at     integer

download_events                        -- nice-to-have, ship in Phase 7
  id          text pk
  file_id     text not null fk -> files.id
  ip_hash     text                     -- hashed, don't keep raw IPs
  user_agent  text
  created_at  integer not null

device_tokens                          -- headless auth for the CLI (§10, Phase 3.5)
  id            text pk
  token_hash    text unique not null   -- SHA-256; the plaintext is shown exactly once
  user_id       text not null fk -> users.id
  label         text                   -- "MacBook CLI"
  created_at    integer not null
  last_used_at  integer
  expires_at    integer                -- null = never
  revoked_at    integer
```

**Ownership scope from day one.** `requireUser()` returns the user *and* a scope. Owners see
every file; members see only rows where `uploaded_by` is their own id. Every file query goes
through one `scopedFiles(user)` helper — retrofitting this in Phase 6 is how you leak someone
else's uploads.

## 4. Link tokens

Download slugs must be unguessable, and that's the *only* access control on the download path.

- 16 random bytes from `crypto.getRandomValues`, base64url-encoded → **22 chars, 128 bits**.
  Example: `8fQ2xR7mKp3wZ1nYtV4bL9`.
- Invite codes: same generator, same length.
- Don't use timestamps, sequential IDs, or filename-derived slugs anywhere in a public URL.
- Return `X-Robots-Tag: noindex, nofollow` and a `<meta name="robots" content="noindex">` on
  download pages, so a pasted link never ends up in a search index.
- Constant-time compare on invite codes and OTPs. Rate-limit slug lookups (see §7).

## 5. Routes

```
Public
  GET  /                          → marketing-free landing: passkey sign-in, or redirect to /app
  GET  /d/:slug                   → download page (filename, size, download button, expiry note)
  GET  /d/:slug/raw               → streams the file from R2; honors Range; increments counter
  GET  /i/:code                   → invite landing; branches on invite.kind
  POST /i/:code/upload-intent     → mints presigned multipart URLs for an anonymous upload
  POST /i/:code/upload-parts      → re-presign specific parts for an in-flight anonymous upload
  POST /i/:code/upload-complete   → completes multipart; increments invite.uses HERE, not at intent
  POST /i/:code/upload-abort      → aborts multipart, deletes the pending row, no use burned

Auth
  POST /auth/passkey/options      → begin authentication (discoverable credentials)
  POST /auth/passkey/verify       → verify assertion, create session
  POST /auth/otp/request          → send OTP (account invites only)
  POST /auth/otp/verify           → verify OTP, mint a registration ticket
  POST /auth/passkey/register     → begin + finish passkey registration
  POST /auth/signout

App (session required)
  GET  /app                       → dropzone + list of my files
  POST /app/upload-intent         → create files row + presigned multipart part URLs
  POST /app/upload-parts          → re-presign {fileId, partNumbers} when URLs expire mid-upload
  POST /app/upload-complete       → complete multipart, mark row 'complete', return the link
  POST /app/upload-abort          → abort multipart, delete row
  POST /app/files/:id/delete      → soft delete + delete R2 object
  POST /app/files/:id/settings    → set expires_at / max_downloads
  GET  /app/invites               → list invites, create/revoke
  POST /app/invites               → create invite (kind, label, email?, max_uploads, expires_at)
  POST /app/invites/:id/revoke
  GET  /app/settings              → manage passkeys, add a new device, list sessions
  POST /app/tokens                → mint a device token for the CLI; plaintext shown once
  POST /app/tokens/:id/revoke
```

All `/app/*` upload endpoints accept **either** a session cookie **or**
`Authorization: Bearer <device-token>`, resolved by one `requireUser()` helper. That's the whole
CLI auth story — no separate API surface.

## 6. Upload flow (the fiddly part — get this right first)

```
browser                          worker                         R2
   │                                │                            │
   │ POST /app/upload-intent        │                            │
   │  {filename, size, type}        │                            │
   │───────────────────────────────>│ insert files row 'pending' │
   │                                │ createMultipartUpload ────>│
   │                                │ presign PUT for each part  │
   │<───────────────────────────────│  {fileId, slug, uploadId,  │
   │                                │   parts:[{n, url}]}        │
   │                                │                            │
   │ PUT part 1..N (parallel, 3-4 at a time) ──────────────────> │
   │<──────────────────────────────── ETag per part ─────────────│
   │                                │                            │
   │ POST /app/upload-complete      │                            │
   │  {fileId, uploadId, etags}     │                            │
   │───────────────────────────────>│ completeMultipartUpload ──>│
   │                                │ status='complete', size    │
   │<───────────────────────────────│  {url: /d/<slug>}          │
```

> ⚠️ **Pick one API and stay in it.** The entire multipart lifecycle — create, part URLs,
> complete, abort — goes over the **S3 API** via `aws4fetch`. Do **not** call
> `env.BUCKET.createMultipartUpload()` on the R2 binding: the `uploadId` it returns is not valid
> for S3-API part uploads or completion, and the failure surfaces late and confusingly. The R2
> binding is used **only** on the download path.

Details that will bite if skipped:

- **Part size**: 5 MB minimum (S3 rule, last part exempt). Use ~16 MB parts, or
  `max(16MB, ceil(size / 9000))` so we never exceed the 10,000-part limit on huge files.
- **Concurrency**: 3–4 parts in flight. More just saturates the uplink and hurts progress UX.
- **Presign TTL**: 1 hour. For very large uploads, allow re-requesting part URLs by
  `{fileId, partNumbers}` rather than restarting the whole upload.
- **Progress**: `XMLHttpRequest.upload.onprogress` per part (fetch still has no upload progress
  in browsers). Aggregate into one overall percentage + per-file rows.
- **CORS on the bucket**: allow `PUT` from `https://tossit.sh` and expose the `ETag` header —
  without `ExposeHeaders: ["ETag"]` the client can't read part ETags and completion fails.
  This is the classic silent failure; configure it in Phase 1, not Phase 3.
- **Small files** (< 5 MB): skip multipart, single presigned `PUT`.
- **Abandoned uploads**: a `pending` row older than 24h → abort the multipart upload and delete
  the row (cron, §7). R2 charges for orphaned parts.
- Signing: `aws4fetch` is the lightest way to presign S3 requests inside a Worker.

## 7. Download guards, lifecycle, limits, abuse

**One guard helper**, `resolveDownloadable(slug)`, used by both `/d/:slug` and `/d/:slug/raw`.
It returns the file only when `status = 'complete'` AND `deleted_at IS NULL` AND
(`expires_at IS NULL` OR `expires_at > now`) AND (`max_downloads IS NULL` OR
`download_count < max_downloads`). Anything else is a 404 — a slug exists from intent time, so
pending and aborted rows are reachable URLs from the moment an upload starts.

**Counting downloads correctly:**

- Increment **only** when the request has no `Range` header, or the range starts at byte 0.
  Resuming browsers and media players fire many ranged GETs for one logical download.
- **Never** count `HEAD` requests, or the `/d/:slug` page view — only `/raw`.
- The increment must be atomic and self-guarding:

  ```sql
  UPDATE files SET download_count = download_count + 1
   WHERE id = ?1 AND (max_downloads IS NULL OR download_count < max_downloads)
  ```

  Check rows-affected and 404 on zero. A read-then-write races straight past `max_downloads`
  when someone shares the link with four people at once.

- **Cron trigger** (daily): delete files past `expires_at`, purge soft-deleted objects, abort
  stale multipart uploads, delete expired invites/OTPs/challenges/sessions.
- **Default expiry**: 30 days, overridable per file (including "never"). Show it plainly on the
  download page so recipients know the link is not forever.
- **Rate limits.** Split by volume — never write to D1 on a hot public path:
  - `/d/:slug`, `/d/:slug/raw`, `/i/:code` — **edge only.** Cloudflare Rate Limiting rules or the
    Workers `ratelimit` binding, keyed by IP. A D1 write per download request would be the single
    most expensive operation in the app.
  - `/auth/otp/request` — **D1 counter is fine**, volume is tiny. 3 per email per 15 min,
    10 per IP per hour.
  - OTP verify — 5 attempts then invalidate the code.
- **Size cap**: 5 GB per file to start. Enforce at intent time (`size` is client-claimed, so
  also verify actual size after `completeMultipartUpload` and reject/delete on mismatch).
- **No virus scanning.** Out of scope; note it on the download page implicitly by showing the
  original filename and size rather than auto-downloading.
- Never return `filename` from user input into a header without sanitizing —
  `Content-Disposition` needs RFC 5987 encoding for non-ASCII names.

## 8. UI

Small and calm. Dark-first, single accent — purple. 💜

- **Landing (`/`)** — the name, one line of explanation, one "Sign in with passkey" button.
- **`/app`** — a big dropzone that takes the whole viewport when empty. Paste support
  (`onPaste`) and a file picker fallback. Below it, the file list: name, size, age, expiry,
  download count, a **Copy link** button that gives instant feedback, and delete.
- **Uploading** — one row per file: name, progress bar, speed, ETA, cancel. On completion the
  row flips to a copyable link and the link is auto-copied with a toast saying so.
- **`/d/:slug`** — filename, size, expiry, one large download button. Nothing else. Must look
  trustworthy to someone who's never heard of this domain — no dark patterns, no interstitial.
- **`/i/:code`** — for `upload` invites, just the dropzone plus who invited them and what
  happens next. For `account` invites, email → OTP → passkey, three screens, no more.
- Use the `designing-frontend` skill when building these out.

## 9. Environment / config

```
# .dev.vars (local) and `wrangler secret put` (deployed)
SESSION_SECRET=            # 32+ random bytes, base64
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=          # R2 API token, scoped to this bucket only
R2_SECRET_ACCESS_KEY=
R2_BUCKET=tossit-files
R2_S3_ENDPOINT=            # https://<account>.r2.cloudflarestorage.com
RESEND_API_KEY=
OTP_FROM_EMAIL=            # e.g. auth@tossit.sh (verify the domain in Resend)
OWNER_EMAIL=kiliman@gmail.com
```

`wrangler.jsonc` bindings: `DB` (D1), `BUCKET` (R2), `ASSETS`, plus a daily `crons` trigger.
WebAuthn `rpID` is `tossit.sh` and `origin` is `https://tossit.sh` in prod, `localhost` in dev —
put both behind a single `getRpConfig(request)` helper so local dev doesn't need a tunnel.

## 10. Build order

Each phase should end in a working, committed, locally-runnable state. Commit locally and often;
don't push to GitHub without asking.

- **Phase 0 — Scaffold.** `git init` first (the directory is not a repo yet). Then `bun create` a
  React Router v7 + Cloudflare app. Tailwind v4, Drizzle,
  Biome/ESLint, `wrangler.jsonc` with D1 + R2 bindings. Confirm `bun run dev` serves a page and
  the Worker can read/write a test object in R2.
- **Phase 1 — Data + storage plumbing.** Full Drizzle schema from §3, first migration, D1 local
  + remote. R2 CORS configured (`PUT`, `ExposeHeaders: ETag`). Presign helper (`aws4fetch`) with
  a script that presigns, uploads, and streams a 200 MB test file end to end. **Do not move on
  until a >200 MB round trip works from a script.**
- **Phase 2 — Owner auth.** Passkey registration bootstrap (a one-shot seeded token or a
  `bun run bootstrap-owner` script that creates the owner row from `OWNER_EMAIL`), then
  passkey sign-in, session cookie, `requireUser()` loader helper, sign-out.
- **Phase 3 — Upload.** `/app` dropzone, upload-intent → parallel parts → complete, progress UI,
  cancel, abort cleanup. This is the heart of the app; spend the time here.
- **Phase 3.5 — Device tokens + CLI.** Do this while the presign code is still warm, not as an
  afterthought — `toss ~/video.mov` is the interface that'll actually get used daily.
  `device_tokens` table, mint/revoke in `/app/settings`, `requireUser()` learns
  `Authorization: Bearer`, and a small `toss` binary that reuses the exact same
  intent → parts → complete endpoints and prints the link to stdout.
- **Phase 4 — Download.** `/d/:slug` page, `/d/:slug/raw` streaming with `Range` support,
  `Content-Disposition` with proper encoding, download counting, expired/missing states,
  `noindex`.
- **Phase 5 — Dashboard.** File list, copy link, delete, per-file expiry and max-downloads.
- **Phase 6 — Invites.** Create/revoke invites. `upload` invites (anonymous, burns after
  `max_uploads`). `account` invites (email → OTP via Resend → passkey registration → member
  account). Members see only their own uploads; owner sees everything.
- **Phase 7 — Lifecycle & hardening.** Cron cleanup, rate limits, size verification after
  completion, `download_events`, passkey management + session revocation in `/app/settings`.
- **Phase 8 — Deploy.** `wrangler deploy`, route `tossit.sh` to the Worker, secrets set, verify
  passkeys work on the real domain (rpID must match exactly), send Michael a real link and have
  someone actually download it.

## 11. Decisions (settled — revisit after v0 ships)

1. **Multiple files per link — no for v1.** One file, one link. Don't let the schema fight a
   future "toss" that bundles several files under one slug and zips on the fly.
2. **Custom slug / vanity links — no.** It's the one feature that breaks the security model.
3. **Download notification — yes, Phase 7**, alongside `download_events`. Cheap once the table
   exists and worth having.
4. **Password-protect a link — no.** A 128-bit slug is already stronger than any password
   someone would actually type.
5. **CLI companion — yes, promoted to Phase 3.5.** See §10.

Everything above is a v0 scope decision, not a permanent one. Ship first, iterate after.
