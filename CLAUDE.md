# tossit.sh

Private file sharing for files too big to email. Drag, drop, get an unguessable link, send it.
Live at <https://tossit.sh>. See README.md for setup, scripts, and deployment.

## Shape of the thing

React Router v8 (framework mode, SSR) on Cloudflare Workers. D1 + Drizzle for metadata, R2 for
bytes, passkeys for auth, Tailwind v4, bun. One Worker serves the app, the download stream, and
the nightly cron.

Bun installs packages and runs the scripts, but the toolchain that builds and deploys the Worker
(react-router, wrangler, Vite) runs on Node, so Node is pinned in `mise.toml` (26, the current
LTS) and CI reads the same file. `@types/node` follows that major. The Worker itself runs on
workerd with `nodejs_compat`, not on Node.

## Ground rules

These are the decisions that took real effort to get right. Breaking one usually looks like it
works until it doesn't.

### Storage

- Uploads go **browser → R2 directly** via presigned URLs. Never proxy file bytes through the
  Worker — the request body limit is 100–200 MB and this app exists for bigger files.
- The whole multipart lifecycle (create, part URLs, complete, abort) goes over the **S3 API**
  via `aws4fetch`. Never `env.BUCKET.createMultipartUpload()` — that `uploadId` is not valid
  for S3-API parts or completion, and the failure surfaces late and confusingly. The R2
  binding is for **downloads only**.
- Downloads stream **R2 → Worker → browser** so expiry, download caps, and revocation are
  enforceable. A presigned download URL could never be taken back.
- Never trust a client-supplied file size. Ask R2 what it actually stored, on completion.
- Always abort a failed or cancelled multipart upload. R2 bills for orphaned parts
  indefinitely, and nothing else reclaims them except the nightly reconcile.
- The bucket CORS policy **must** expose `ETag`. Without it the browser can't read part ETags
  and completion fails with no useful error.
- In local dev the R2 binding is `"remote": true`, because presigned uploads always land in the
  real bucket. D1 stays local, so dev metadata never touches production.

### Secrets and tokens

- Anything reachable from a public URL — download slugs, invite codes — is 16 random bytes,
  base64url, 22 chars. Never sequential, never timestamped, never derived from a filename.
- Store OTPs and device tokens hashed. Constant-time compare invite codes and OTPs.
- Auth is passkeys only. No passwords, ever. OTP exists solely to verify an email during invite
  claim, and never signs anyone in on its own.
- `getRequestOrigin()` takes the scheme from `X-Forwarded-Proto` but the host from the actual
  request. Host determines the WebAuthn rpID; honoring a client-supplied `X-Forwarded-Host`
  would let a caller nominate the relying party.

### Access

- `requireUser()` accepts a session cookie **or** `Authorization: Bearer <device-token>`. That
  is the entire CLI auth story — there is deliberately no parallel API surface.
- It returns `uploaderScope`: `null` for owner/admin, the user's own id for members. Every file
  query goes through it. Retrofitting that is how you leak someone else's uploads.
- Roles: `owner` (exactly one, created by bootstrap, role immutable through the app),
  `admin` (everything except touching the owner), `member` (own files only).
- Privileged routes return **404**, not 403 — a member has no business learning they exist.
- Approving a CLI device code requires a real passkey-backed session. A device token can never
  approve another device.

### Download path

- `resolveDownloadable()` is the single gate for the page and both byte streams (`/raw` and
  `/view`), so they can never disagree. A slug exists from the moment an upload starts, so
  pending, aborted, deleted, expired, and exhausted rows are all rejected there.
- Count a download only on an opening request — no `Range` header, or one starting at byte 0 —
  and never on `HEAD`. A video player scrubbing an MP4 or a link previewer would otherwise
  inflate the count and burn capped links.
- Claim the download slot with a conditional `UPDATE` and a rows-affected check. A
  read-then-write races straight past `max_downloads`.
- `Content-Disposition` needs RFC 5987 encoding plus an ASCII fallback, or non-ASCII filenames
  save as "download".

### Previews

- The download page shows video, audio and images in place, using the browser's own player or
  an `<img>`, with the Download button always below. Anything the browser can't decode hides
  the preview and falls back to filename, size and Download.
- Preview bytes come from `/d/:slug/view`, never `/raw`. It serves `Content-Disposition: inline`,
  `nosniff`, the allowlisted type (never the raw stored string), and a CSP that sandboxes the
  document without scripts. Keep `allow-same-origin` and `media-src`/`img-src 'self'` in it:
  plain `sandbox; default-src 'none'` breaks a video opened in its own tab in Chrome.
- `content_type` is the uploader's `File.type`, so the allowlist in `app/lib/preview.ts` is the
  only gate. Anything off it gets a 404 from `/view`. Never add SVG, HTML, XHTML or XML.
- **Views and downloads are counted separately.** `/view` bumps `view_count` and never touches
  `reserveDownload()`, `download_count` or `max_downloads`: a capped link limits downloads,
  not watching. Only `/raw` counts downloads, and only `/raw` honors the cap.
- Views follow the opening-request rule, except Safari's `bytes=0-1` probe, which doesn't
  count (it precedes the real `bytes=0-`, and would double every play).

### Conventions

- Timestamps are unix epoch **milliseconds**, stored as integers.
- Deleting a file destroys the bytes immediately but keeps the row as a tombstone, so a slug is
  never reissued. The cron purges tombstones after 90 days.
- The nightly cron is the only thing reclaiming storage. A cron that fails quietly shows up as
  a bill rather than an error, so it logs a report and can be run by hand from Settings.

## Working on this

- The UI wears Claudia's look from the `applying-claudia-style` skill: light only, cream with violet and rose
  washes, Newsreader for the voice. `app/claudia.css` is a copy of the skill's `theme.css` (change it there,
  then copy it back), and every page ends with `<Signature />` from `app/components/brand.tsx`.
- `bun run check` and `bun run typecheck` should both be clean before committing.
- Run the dev server as its own isolated command. Backgrounding it inside a command that also
  does other work orphans the process and wedges the tmux pane.
- Test scripts should batch their D1 statements — each `wrangler d1 execute` is a process
  launch, and dozens of them in a loop is what jams the shell.
- No virus scanning, by design: uploaders are invited and trusted. The download page shows the
  original filename and size, and never starts a download on its own (previews are views, see
  above).
- `vite.config.ts` pins `tsconfigPaths({ root: import.meta.dirname })`. Without it,
  vite-tsconfig-paths crawls Vite's workspace root for tsconfig files, and any stray workspace
  file above the repo (a `pnpm-workspace.yaml` in `$HOME` did it once, removed 2026-11-15)
  widens that root to the whole home directory, which dies with
  `EINVAL … scandir ~/Library/Developer/CoreDevice/DeviceFS/…` in typegen and build.

## Releasing the CLI

`@iamclaudia/tossit` (in `cli/`) is published by the `iamclaudia-ai` account. CLI releases use
their own tags, `cli-vX.Y.Z`, separate from app deploys.

1. Bump `version` in `cli/package.json` and commit `chore(cli): release vX.Y.Z` on `main`.
2. `git tag -a cli-vX.Y.Z -m "CLI vX.Y.Z — summary" && git push && git push origin cli-vX.Y.Z`
3. The tag runs `.github/workflows/publish.yml`: checks, verifies the tag matches
   `cli/package.json`, builds `cli/dist/tossit.js`, and publishes with npm trusted publishing
   (OIDC, no token). Watch with `gh run watch`, confirm with
   `npm view @iamclaudia/tossit version --prefer-online` (npm lags a minute or two; never re-publish).

The trusted publisher on npmjs.com names this repo and `publish.yml`; renaming the workflow
breaks publishing until that setting matches.
