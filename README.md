# tossit.sh

Toss a big file, get a link, send the link.

Private file sharing for files too big to email. See [PLAN.md](./PLAN.md) for the full spec —
it's the source of truth until the code catches up to it.

## Stack

React Router v7 (framework mode, SSR) on Cloudflare Workers, D1 + Drizzle, R2 for storage,
passkeys for auth, Tailwind v4, bun.

## Setup

```sh
bun install
cp .dev.vars.example .dev.vars   # then fill it in
bun run db:migrate               # apply migrations to local D1
bun run dev                      # http://localhost:5173
```

`GET /health` exercises both the D1 and R2 bindings and should return
`{"status":"ok","checks":{"d1":"ok","r2":"ok"}}`.

### Cloudflare resources

These need to exist before anything touches the remote environment:

```sh
wrangler login
wrangler d1 create tossit          # put the returned id in wrangler.jsonc
wrangler r2 bucket create tossit-files
wrangler r2 bucket cors put tossit-files --file r2-cors.json
bun run db:migrate:remote
```

The bucket stays **private** — downloads stream through the Worker so expiry, download caps,
and revocation are enforceable.

## Scripts

| Command               | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `bun run dev`         | Dev server with local D1 + R2 emulation                |
| `bun run check`       | Biome lint + format check (`check:fix` to write)       |
| `bun run typecheck`   | Regenerate binding types, then `tsc -b`                |
| `bun run db:generate` | Generate a migration from `app/db/schema.ts`           |
| `bun run db:migrate`  | Apply migrations to local D1 (`:remote` for production) |
| `bun run deploy`      | `wrangler deploy`                                      |

## The Phase 1 gate

Before any upload UI gets built, a >200 MB file has to survive a full multipart round trip
through the same helpers the app uses:

```sh
bun run scripts/r2-roundtrip.ts 250
```

It presigns parts, uploads them in parallel, completes the multipart upload, verifies the
stored size, downloads the object back, and compares SHA-256 end to end.

## Ground rules

- Uploads go **browser → R2 directly** via presigned multipart URLs. File bytes never pass
  through the Worker.
- The entire multipart lifecycle goes over the **S3 API** (`aws4fetch`), never
  `env.BUCKET.createMultipartUpload()` — that uploadId isn't valid for S3-API parts. The R2
  binding is for downloads only.
- Public tokens are 16 random bytes, base64url, 22 chars. Never sequential or derived from a
  filename.
- Auth is passkeys only. OTP exists solely to verify an email during invite claim.
