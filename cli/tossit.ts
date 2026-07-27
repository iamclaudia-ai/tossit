#!/usr/bin/env node
/**
 * tossit — command line client for tossit.sh
 *
 *   tossit login               link this terminal to your account
 *   tossit <file>              upload a file, print the link
 *   tossit list                recent uploads
 *   tossit whoami              who this terminal is signed in as
 *   tossit logout              forget the local token
 *
 * Config lives at $XDG_CONFIG_HOME/tossit/config.json (defaults to ~/.config/tossit),
 * mode 600.
 *
 * Deliberately node-only — no Bun APIs — so it ships to npm and runs under npx.
 */

import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Bundled inline at build time, so `tossit --version` can never drift from the published
// package the way a hand-maintained constant does.
import pkg from "./package.json" with { type: "json" };

const VERSION = pkg.version;
const DEFAULT_HOST = "https://tossit.sh";
const CONCURRENCY = 4;

// ---------------------------------------------------------------- config ----

interface Config {
	host: string;
	token?: string;
	email?: string;
}

function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	return join(xdg?.trim() ? xdg : join(homedir(), ".config"), "tossit");
}

const CONFIG_PATH = join(configDir(), "config.json");

function readConfig(): Config {
	const host = process.env.TOSSIT_HOST?.replace(/\/$/, "");
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
		return { ...parsed, host: host ?? parsed.host ?? DEFAULT_HOST };
	} catch {
		return { host: host ?? DEFAULT_HOST };
	}
}

function writeConfig(config: Config): void {
	mkdirSync(configDir(), { recursive: true, mode: 0o700 });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	// writeFileSync's mode only applies on creation, so tighten an existing file too.
	chmodSync(CONFIG_PATH, 0o600);
}

// -------------------------------------------------------------------- ui ----

const isTTY = process.stdout.isTTY === true;
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const accent = (s: string) => (isTTY ? `\x1b[35m${s}\x1b[0m` : s);
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);

/** Status goes to stderr so `tossit file | pbcopy` pipes only the link. */
const status = (line: string) => process.stderr.write(`${line}\n`);

function fail(message: string, cause?: unknown): never {
	process.stderr.write(`${red("error")} ${message}\n`);

	// undici reports transport problems as a bare "fetch failed"; everything useful — DNS,
	// TLS, ECONNRESET, the actual host — is on the cause chain.
	let current: unknown = cause;
	while (current instanceof Error) {
		const code = (current as NodeJS.ErrnoException).code;
		process.stderr.write(`  ${dim("↳")} ${current.message}${code ? ` (${code})` : ""}\n`);
		current = current.cause;
	}
	process.exit(1);
}

function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function progressBar(fraction: number, width = 24): string {
	const filled = Math.round(fraction * width);
	return `${"█".repeat(filled)}${dim("░".repeat(width - filled))}`;
}

// ------------------------------------------------------------------ http ----

async function api<T>(
	config: Config,
	path: string,
	init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json");
	if (init.auth !== false && config.token) {
		headers.set("authorization", `Bearer ${config.token}`);
	}

	let response: Response;
	try {
		response = await fetch(`${config.host}${path}`, {
			...init,
			headers,
			redirect: "manual",
		});
	} catch (error) {
		fail(`Couldn't reach ${config.host}.`, error);
	}

	if (response.status === 401) fail("Token invalid or revoked. Run: tossit login");
	if (response.status === 302) fail("Not signed in. Run: tossit login");

	const text = await response.text();
	const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	if (!response.ok) {
		fail((payload.error as string) ?? `Request failed (${response.status}).`);
	}
	return payload as T;
}

// ----------------------------------------------------------------- login ----

async function login(): Promise<void> {
	const config = readConfig();
	const label = `${process.env.USER ?? "cli"}@${process.env.HOSTNAME ?? "terminal"}`;

	const start = await api<{
		userCode: string;
		deviceCode: string;
		verificationUri: string;
		expiresIn: number;
		interval: number;
	}>(config, "/auth/device/start", {
		method: "POST",
		body: JSON.stringify({ label }),
		auth: false,
	});

	status("");
	status(`  Open   ${accent(start.verificationUri)}`);
	status(`  Code   ${bold(start.userCode)}`);
	status("");
	status(dim("  Waiting for approval…"));

	// A convenience, never a requirement — this has to work over SSH.
	openBrowser(`${start.verificationUri}?code=${encodeURIComponent(start.userCode)}`);

	const deadline = Date.now() + start.expiresIn * 1000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, start.interval * 1000));

		const response = await fetch(`${config.host}/auth/device/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ deviceCode: start.deviceCode }),
		});

		if (response.status === 202) continue;
		if (response.status === 410) fail("That login request expired. Run: tossit login");
		if (!response.ok) fail(`Login failed (${response.status}).`);

		const { token } = (await response.json()) as { token: string };
		const me = await api<{ email: string }>({ ...config, token }, "/app/whoami");

		writeConfig({ host: config.host, token, email: me.email });
		status("");
		status(`  ${accent("✓")} Signed in as ${bold(me.email)}`);
		status(dim(`  Token stored in ${CONFIG_PATH}`));
		return;
	}

	fail("Timed out waiting for approval.");
}

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	try {
		spawn(command, [url], { stdio: "ignore", detached: true }).unref();
	} catch {
		// Headless is a normal case, not an error.
	}
}

function logout(): void {
	if (existsSync(CONFIG_PATH)) {
		rmSync(CONFIG_PATH);
		status("Signed out. Revoke the token in Settings to invalidate it server-side.");
	} else {
		status("Not signed in.");
	}
}

function requireAuth(): Config {
	const config = readConfig();
	if (!config.token) fail("Not signed in. Run: tossit login");
	return config;
}

async function whoami(): Promise<void> {
	const config = requireAuth();
	const me = await api<{ email: string; role: string }>(config, "/app/whoami");
	process.stdout.write(`${me.email} (${me.role}) at ${config.host}\n`);
}

// ---------------------------------------------------------------- upload ----

interface IntentResponse {
	fileId: string;
	slug: string;
	partSize?: number;
	parts?: { partNumber: number; url: string }[];
	single?: { url: string };
}

const MAX_ATTEMPTS = 3;

/**
 * PUT one chunk, retrying transient transport failures.
 *
 * Uploads are long and networks are not: a single dropped connection twenty minutes into a
 * multi-gigabyte transfer should not throw the whole thing away. Retries cover network errors
 * and 5xx/429 from storage — never a 4xx, which means the request itself is wrong and would
 * fail identically forever.
 *
 * A raw fetch reports transport problems as a bare "fetch failed"; the cause chain carries
 * everything useful, so it is surfaced on the final attempt.
 */
async function putChunk(url: string, body: Buffer, what: string): Promise<Response> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url, {
				method: "PUT",
				body: new Uint8Array(body),
			});

			if (response.ok) return response;
			if (response.status < 500 && response.status !== 429) return response;

			lastError = new Error(`storage returned ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		if (attempt < MAX_ATTEMPTS) {
			const backoff = 2 ** (attempt - 1) * 1000;
			status(dim(`  ${what} failed, retrying in ${backoff / 1000}s…`));
			await new Promise((resolve) => setTimeout(resolve, backoff));
		}
	}

	throw new UploadError(
		`${what} could not be sent to storage after ${MAX_ATTEMPTS} attempts.`,
		lastError,
	);
}

/** Carries the transport cause so the top level can print the chain. */
class UploadError extends Error {
	constructor(message: string, cause: unknown) {
		super(message);
		this.name = "UploadError";
		this.cause = cause;
	}
}

/** Reads one byte range rather than the whole file — these are large by definition. */
async function readChunk(path: string, start: number, length: number): Promise<Buffer> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, start);
		return buffer;
	} finally {
		await handle.close();
	}
}

async function upload(path: string, options: Set<string>): Promise<void> {
	const config = requireAuth();

	if (!existsSync(path)) fail(`No such file: ${path}`);
	const stat = statSync(path);
	if (stat.isDirectory()) fail("Directories aren't supported — pass a single file.");

	const name = basename(path);
	const total = stat.size;
	status(`${bold(name)} ${dim(formatBytes(total))}`);

	const intent = await api<IntentResponse>(config, "/app/upload-intent", {
		method: "POST",
		body: JSON.stringify({ filename: name, size: total }),
	});

	let uploaded = 0;
	const started = Date.now();
	const render = () => {
		if (!isTTY) return;
		const fraction = total ? uploaded / total : 1;
		const elapsed = (Date.now() - started) / 1000;
		const rate = elapsed > 0 ? uploaded / elapsed : 0;
		const eta = rate > 0 ? (total - uploaded) / rate : 0;
		process.stderr.write(
			`\r  ${progressBar(fraction)} ${String(Math.round(fraction * 100)).padStart(3)}%  ` +
				`${formatBytes(rate)}/s  ${dim(`${Math.ceil(eta)}s left`)}   `,
		);
	};

	let completeBody: Record<string, unknown>;

	// Any failure past this point must abort the upload: an orphaned multipart upload keeps
	// billing until the nightly cron notices it. A thrown fetch used to skip this entirely.
	try {
		if (intent.single) {
			const body = await readChunk(path, 0, total);
			const response = await putChunk(intent.single.url, body, "The file");
			if (!response.ok)
				throw new UploadError(`Upload failed (${response.status}).`, null);
			uploaded = total;
			render();
			completeBody = { fileId: intent.fileId };
		} else {
			const partSize = intent.partSize as number;
			const parts = intent.parts ?? [];
			const etags: { partNumber: number; etag: string }[] = [];
			let cursor = 0;

			await Promise.all(
				Array.from({ length: Math.min(CONCURRENCY, parts.length) }, async () => {
					while (cursor < parts.length) {
						const part = parts[cursor++];
						const start = (part.partNumber - 1) * partSize;
						const length = Math.min(partSize, total - start);
						const body = await readChunk(path, start, length);

						const response = await putChunk(part.url, body, `Part ${part.partNumber}`);
						if (!response.ok) {
							throw new UploadError(
								`Part ${part.partNumber} failed (${response.status}).`,
								null,
							);
						}

						const etag = response.headers.get("etag");
						if (!etag) {
							throw new UploadError(
								"Storage returned no ETag — check the bucket CORS configuration.",
								null,
							);
						}

						etags.push({ partNumber: part.partNumber, etag });
						uploaded += length;
						render();
					}
				}),
			);
			completeBody = { fileId: intent.fileId, parts: etags };
		}
	} catch (error) {
		await abort(config, intent.fileId);
		throw error;
	}

	if (isTTY) process.stderr.write("\n");

	const done = await api<{ url: string }>(config, "/app/upload-complete", {
		method: "POST",
		body: JSON.stringify(completeBody),
	});

	// The link is the only thing on stdout, so piping does the obvious thing.
	process.stdout.write(`${done.url}\n`);
	if (options.has("copy")) copyToClipboard(done.url);
}

async function abort(config: Config, fileId: string): Promise<void> {
	await fetch(`${config.host}/app/upload-abort`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${config.token}`,
		},
		body: JSON.stringify({ fileId }),
	}).catch(() => {});
}

function copyToClipboard(text: string): void {
	const command =
		process.platform === "darwin"
			? ["pbcopy"]
			: process.platform === "win32"
				? ["clip"]
				: ["xclip", "-selection", "clipboard"];
	try {
		const proc = spawn(command[0], command.slice(1), {
			stdio: ["pipe", "ignore", "ignore"],
		});
		proc.stdin.write(text);
		proc.stdin.end();
		status(dim("  copied to clipboard"));
	} catch {
		// No clipboard available; the link is already on stdout.
	}
}

async function list(): Promise<void> {
	const config = requireAuth();
	const { files } = await api<{
		files: {
			filename: string;
			size: number | null;
			url: string;
			downloadCount: number;
		}[];
	}>(config, "/app/files.json");

	if (!files.length) {
		status("Nothing tossed yet.");
		return;
	}

	for (const file of files.slice(0, 20)) {
		const size = formatBytes(file.size ?? 0).padStart(8);
		const downloads = file.downloadCount > 0 ? dim(` ${file.downloadCount}↓`) : "";
		process.stdout.write(`${dim(size)}  ${file.url}  ${file.filename}${downloads}\n`);
	}
}

// ------------------------------------------------------------------ main ----

function help(): string {
	return `${bold("tossit")} — private file sharing for files too big to email

${bold("Usage")}
  tossit <file>            upload a file and print its link
  tossit login             link this terminal to your account
  tossit logout            forget the local token
  tossit whoami            show who this terminal is signed in as
  tossit list              recent uploads

${bold("Options")}
  --copy                   also copy the link to the clipboard
  --host <url>             override the server for one command
  --version                print the version

${bold("Environment")}
  TOSSIT_HOST              default server (currently ${readConfig().host})

Config: ${CONFIG_PATH}
`;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const options = new Set<string>();
	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--host") {
			process.env.TOSSIT_HOST = argv[++i];
		} else if (arg.startsWith("--")) {
			options.add(arg.slice(2));
		} else {
			positional.push(arg);
		}
	}

	if (options.has("version")) {
		process.stdout.write(`${VERSION}\n`);
		return;
	}

	const command = positional[0];
	if (!command || options.has("help") || command === "help") {
		process.stdout.write(help());
		return;
	}

	switch (command) {
		case "login":
			return await login();
		case "logout":
			return logout();
		case "whoami":
			return await whoami();
		case "list":
		case "ls":
			return await list();
		default:
			// Anything else is a path — `tossit video.mov` is the whole point.
			return await upload(command, options);
	}
}

main().catch((error) => fail((error as Error).message, (error as Error).cause));
