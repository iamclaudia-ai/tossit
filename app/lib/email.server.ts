/**
 * Transactional email via Resend. The only mail this app sends is invite OTPs.
 */

interface SendArgs {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export async function sendEmail(env: Env, args: SendArgs): Promise<void> {
	if (!env.RESEND_API_KEY) {
		throw new Error("Email is not configured (RESEND_API_KEY is unset).");
	}

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.RESEND_API_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			from: `tossit <${env.OTP_FROM_EMAIL}>`,
			to: [args.to],
			subject: args.subject,
			html: args.html,
			text: args.text,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		// Surfaced to the caller, never to the end user — it can echo the address.
		throw new Error(
			`Resend rejected the message (${response.status}): ${body.slice(0, 300)}`,
		);
	}
}

export function otpEmail(code: string, inviterNote: string | null) {
	const subject = `${code} is your tossit code`;

	const text = [
		`Your tossit verification code is ${code}.`,
		"",
		"It expires in 10 minutes and can only be used once.",
		inviterNote ? `\nInvitation note: ${inviterNote}` : "",
		"",
		"If you weren't expecting this, you can ignore it — nothing happens without the code.",
	].join("\n");

	// Inlined styles and a table-free layout: mail clients are not browsers.
	const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#141318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#dcdae1">
  <div style="max-width:420px;margin:0 auto">
    <p style="margin:0 0 24px;font-size:15px;font-weight:600;letter-spacing:-0.01em">toss<span style="color:#a970ff">it</span></p>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.5">Your verification code:</p>
    <p style="margin:0 0 24px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:32px;font-weight:600;letter-spacing:0.18em;color:#a970ff">${code}</p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#8b8794">It expires in 10 minutes and can only be used once.</p>
    ${inviterNote ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#8b8794">Invitation note: ${escapeHtml(inviterNote)}</p>` : ""}
    <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#5c5866">If you weren't expecting this, ignore it — nothing happens without the code.</p>
  </div>
</body></html>`;

	return { subject, text, html };
}

/**
 * The invitation itself, sent when the invite is created. The OTP that follows proves the
 * recipient controls the inbox; this one just gets the link to them without the owner having
 * to copy-paste it into a message.
 */
export function inviteEmail(args: {
	url: string;
	kind: "upload" | "account";
	label: string | null;
	expiresAt: number | null;
}) {
	const isUpload = args.kind === "upload";
	const subject = isUpload
		? "You can send a file via tossit"
		: "You've been invited to tossit";

	const lead = isUpload
		? "Someone would like you to send them a file. This link takes you to a private upload page — no account, no sign-up, one file."
		: "You've been invited to tossit, a private place to send and receive large files. Setting up takes about thirty seconds: confirm your email, then create a passkey.";

	const expiry = args.expiresAt
		? `This link expires ${new Date(args.expiresAt).toUTCString().replace(/ GMT$/, " UTC")}.`
		: "";

	const text = [
		lead,
		"",
		args.url,
		"",
		args.label ? `Note: ${args.label}` : "",
		expiry,
		"",
		"If you weren't expecting this, you can ignore it.",
	]
		.filter(Boolean)
		.join("\n");

	const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#141318;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#dcdae1">
  <div style="max-width:440px;margin:0 auto">
    <p style="margin:0 0 24px;font-size:15px;font-weight:600;letter-spacing:-0.01em">toss<span style="color:#a970ff">it</span></p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(lead)}</p>
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(args.url)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#a970ff;color:#fff;font-size:15px;font-weight:500;text-decoration:none">${isUpload ? "Send a file" : "Accept invitation"}</a>
    </p>
    ${args.label ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#8b8794">Note: ${escapeHtml(args.label)}</p>` : ""}
    ${expiry ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#8b8794">${escapeHtml(expiry)}</p>` : ""}
    <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#5c5866">Or paste this into your browser:<br><span style="word-break:break-all">${escapeHtml(args.url)}</span></p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#5c5866">If you weren't expecting this, you can ignore it.</p>
  </div>
</body></html>`;

	return { subject, text, html };
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
