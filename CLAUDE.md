# tossit.sh

Private file sharing for files too big to email. Drag, drop, get an unguessable link, send it.

**Read `PLAN.md` first** — it holds the full spec, data model, upload architecture, and build
order. It is the source of truth until the code catches up to it.

## Domain & infra (already provisioned by Michael)

- `tossit.sh` — registered on Cloudflare
- `files.tossit.sh` — R2 bucket. Keep it **private**; downloads stream through the Worker.

## Ground rules

- Uploads go **browser → R2 directly** via presigned multipart URLs. Never proxy file bytes
  through the Worker — the body limit is 100–200 MB and this app exists for bigger files.
- The whole multipart lifecycle (create, part URLs, complete, abort) goes over the **S3 API**
  via `aws4fetch`. Never `env.BUCKET.createMultipartUpload()` — that `uploadId` is not valid for
  S3-API parts or completion. The R2 binding is for **downloads only**.
- Downloads stream **R2 → Worker → browser** so expiry, download caps, and revocation are
  actually enforceable.
- Public tokens (download slugs, invite codes) are 16 random bytes, base64url, 22 chars.
  Never sequential, never timestamped, never derived from a filename.
- Auth is passkeys only. No passwords, ever. OTP exists solely to verify an email during
  invite claim.
- Store OTPs hashed. Constant-time compare invite codes and OTPs.
