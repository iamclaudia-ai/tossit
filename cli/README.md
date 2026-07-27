# @iamclaudia/tossit

Command line client for [tossit.sh](https://tossit.sh) — toss a big file, get a link, send the link.

```sh
npm install -g @iamclaudia/tossit
tossit login
tossit ~/video.mov
# https://tossit.sh/d/8fQ2xR7mKp3wZ1nYtV4bL9
```

Or without installing: `npx @iamclaudia/tossit ~/video.mov`

## Commands

| | |
| --- | --- |
| `tossit <file>` | Upload a file and print its link |
| `tossit login` | Link this terminal to your account |
| `tossit logout` | Forget the local token |
| `tossit whoami` | Show who this terminal is signed in as |
| `tossit list` | Recent uploads |

**Options** — `--copy` also copies the link to the clipboard, `--host <url>` overrides
the server for one command, `--version` prints the version.

## Authentication

`tossit login` uses the OAuth device-authorization flow: the terminal displays a short code,
you approve it in a browser where you're already signed in with a passkey, and the terminal
receives a token. No password, no secret to paste, and it works over SSH.

The token is stored in `$XDG_CONFIG_HOME/tossit/config.json` (defaults to
`~/.config/tossit/config.json`) with mode `600`. The server only ever stores its SHA-256, and
you can revoke it from Settings at any time — `tossit logout` only forgets it locally.

## Piping

Only the link goes to stdout; progress and status go to stderr. So this does the obvious thing:

```sh
tossit big.zip | pbcopy
echo "here you go: $(tossit report.pdf)" | mail -s "report" someone@example.com
```

## Uploads

Files go **directly to storage** from your machine using presigned URLs — they never pass
through the application server. Anything over 5 MB is uploaded as multipart with four parts in
flight, and only one part is held in memory at a time, so file size is not bounded by your RAM.

Requires Node 18+.

## Self-hosting

Point the CLI at your own deployment:

```sh
export TOSSIT_HOST=https://files.example.com
tossit login
```

Source: <https://github.com/iamclaudia-ai/tossit>
