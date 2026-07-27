# tossit.sh

Toss a big file, get a link, send the link.

Private file sharing for files too big to email — no Google Drive, no iCloud, no account for
the person receiving it. Drag a file onto the page, get back an unguessable link, send it to
whoever needs it. Live at <https://tossit.sh>.

There's a CLI too: [`@iamclaudia/tossit`](./cli) — `tossit ~/video.mov` prints a link.

## What it does

- **Upload** — drag, paste, or pick a file up to 5 GB. Bytes go from your browser straight to
  storage; the link is copied to your clipboard the moment it finishes.
- **Share** — recipients get a calm download page: filename, size, expiry, one button. No
  account, no app, no interstitial.
- **Control** — set expiry (1 hour to never) and a download cap per link, or delete a link and
  its bytes outright.
- **Receive** — send someone a one-time upload link and they can send *you* a file, with no
  account at all.
- **Invite** — give someone their own account: email, a 6-digit code, then a passkey.

## Stack

React Router v7 (framework mode, SSR) on Cloudflare Workers · D1 + Drizzle · R2 · passkeys via
`@simplewebauthn` · Resend for invite codes · Tailwind v4 · bun.

Uploads never pass through the Worker — the browser talks to R2 directly over presigned
multipart URLs. Downloads *do* stream through the Worker, which is what makes expiry, download
caps, and revocation enforceable. See [CLAUDE.md](./CLAUDE.md) for the architectural rules and
why each one exists.

## Setup

```sh
bun install
cp .dev.vars.example .dev.vars   # then fill it in
bun run db:migrate               # apply migrations to local D1
bun run dev                      # http://localhost:5173
```

`GET /health` exercises both bindings and should return
`{"status":"ok","checks":{"d1":"ok","r2":"ok"}}`.

### First run

The app has no signup. One owner is seeded from `OWNER_EMAIL`, and the first visit offers to
create their passkey — a window that closes permanently once one exists. Everyone after that
arrives by invite.

```sh
bun run scripts/bootstrap-owner.ts            # local
bun run scripts/bootstrap-owner.ts --remote   # production
```

Then open the app and click **Create your passkey**. Do this promptly after a production
deploy: until that passkey exists, anyone who reaches the site could claim the owner account.

### Cloudflare resources

```sh
wrangler login
wrangler d1 create tossit          # put the returned id in wrangler.jsonc
wrangler r2 bucket create tossit-files
wrangler r2 bucket cors put tossit-files --file r2-cors.json
bun run db:migrate:remote
```

The bucket stays **private**. Local dev needs a workers.dev subdomain registered on the
account, because the R2 binding runs in remote mode — presigned uploads always land in the real
bucket, so a local simulation would 404 on files that plainly exist.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server, local D1 + real R2 |
| `bun run check` | Biome lint + format (`check:fix` to write) |
| `bun run typecheck` | Regenerate binding types, then `tsc -b` |
| `bun run db:generate` | Generate a migration from `app/db/schema.ts` |
| `bun run db:migrate` | Apply migrations locally (`:remote` for production) |
| `bun run cli:build` | Build the CLI to `cli/dist` |
| `bun run deploy` | `wrangler deploy` |

`bun run scripts/r2-roundtrip.ts 250` uploads a 250 MB file through the real multipart path and
compares SHA-256 on the way back — useful for confirming storage credentials and CORS.

## Roles

| | owner | admin | member |
| --- | --- | --- | --- |
| Upload, get links | ✅ | ✅ | ✅ |
| See all files | ✅ | ✅ | own only |
| Invites, People, cleanup | ✅ | ✅ | — |
| Change the owner | — | — | — |

There is exactly one owner, created by bootstrap. Its role can't be changed through the app by
anyone, including itself, so there is always an account that can get back in.

## Maintenance

A cron runs nightly at 04:17 UTC: expires files, aborts abandoned uploads, purges old
tombstones and dead auth records, and reconciles stored objects against the database. It can
also be run on demand from **Settings → Maintenance**, which reports exactly what it touched.

## Deploying

```sh
bun run deploy
```

Secrets are set with `wrangler secret bulk` or `wrangler secret put` — see
`.dev.vars.example` for the list. `SESSION_SECRET` must be different in production; sharing a
signing key means a dev session cookie is valid in production.
