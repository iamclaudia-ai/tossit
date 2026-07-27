import { useEffect, useState } from "react";

/** Copy with instant, obvious feedback — the whole product is "get a link, send the link". */
export function CopyButton({
	value,
	className = "",
	label = "Copy link",
}: {
	value: string;
	className?: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<button
			type="button"
			onClick={async () => {
				await copyText(value);
				setCopied(true);
			}}
			className={`rounded-lg px-3 py-1.5 font-medium text-sm transition ${
				copied ? "bg-accent text-white" : "bg-ink-850 text-ink-200 hover:bg-ink-800"
			} ${className}`}
		>
			{copied ? "Copied" : label}
		</button>
	);
}

/**
 * navigator.clipboard needs a secure context and can be blocked; the textarea fallback keeps
 * copy working rather than silently doing nothing.
 */
export async function copyText(value: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value);
		return;
	} catch {
		const textarea = document.createElement("textarea");
		textarea.value = value;
		textarea.setAttribute("readonly", "");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		try {
			document.execCommand("copy");
		} finally {
			document.body.removeChild(textarea);
		}
	}
}
