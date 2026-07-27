/** Display helpers. Binary units, because file managers report binary units. */

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number | null): string {
	if (bytes === null || !Number.isFinite(bytes)) return "—";
	if (bytes < 1024) return `${bytes} B`;

	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

export function formatRate(bytesPerSecond: number | null): string {
	if (!bytesPerSecond) return "—";
	return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds)) return "—";
	if (seconds < 60) return `${Math.ceil(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${Math.ceil(seconds % 60)}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "3 days left", "expires today", "never expires". */
export function formatExpiry(expiresAt: number | null): string {
	if (expiresAt === null) return "never expires";
	const remaining = expiresAt - Date.now();
	if (remaining <= 0) return "expired";

	const days = Math.floor(remaining / 86_400_000);
	if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
	const hours = Math.floor(remaining / 3_600_000);
	if (hours >= 1) return `${hours}h left`;
	return "expires within the hour";
}

export function formatAge(timestamp: number): string {
	const elapsed = Date.now() - timestamp;
	if (elapsed < 60_000) return "just now";
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
