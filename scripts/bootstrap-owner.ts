/**
 * Creates the owner row from OWNER_EMAIL so the first passkey has something to attach to.
 *
 *   bun run scripts/bootstrap-owner.ts            # local D1
 *   bun run scripts/bootstrap-owner.ts --remote   # production D1
 *
 * Idempotent: running it twice does nothing the second time. It deliberately does NOT create
 * a credential — the passkey is registered from the browser on first visit, and that bootstrap
 * window closes as soon as one exists.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const remote = process.argv.includes("--remote");

function devVar(key: string): string {
	const raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		if (trimmed.slice(0, eq).trim() === key) {
			return trimmed
				.slice(eq + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
		}
	}
	throw new Error(`Missing ${key} in .dev.vars`);
}

function d1(sql: string): string {
	return execFileSync(
		"bunx",
		[
			"wrangler",
			"d1",
			"execute",
			"tossit",
			remote ? "--remote" : "--local",
			"--json",
			"--command",
			sql,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
}

/** SQLite string literal — doubles any embedded quote. */
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

const email = devVar("OWNER_EMAIL");
const target = remote ? "remote" : "local";

const existing = JSON.parse(d1(`select id, role from users where email = ${lit(email)}`));
const rows = existing[0]?.results ?? [];

if (rows.length > 0) {
	console.log(`Owner already exists in ${target} D1: ${email} (${rows[0].id})`);
	process.exit(0);
}

// nanoid, inlined so this script has no import cycle with app code.
const id = Array.from(crypto.getRandomValues(new Uint8Array(21)))
	.map(
		(byte) =>
			"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict"[byte & 63],
	)
	.join("");

d1(
	`insert into users (id, email, name, role, created_at) values (${lit(id)}, ${lit(email)}, null, 'owner', ${Date.now()})`,
);

console.log(`Created owner in ${target} D1: ${email} (${id})`);
console.log("Now open the app and click “Create your passkey”.");
