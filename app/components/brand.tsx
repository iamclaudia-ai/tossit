import { Link } from "react-router";

const WORDMARK_SIZES = {
	md: "text-2xl",
	lg: "text-6xl sm:text-7xl",
};

/** "toss" in Newsreader with the "it" in italic violet: the name is the whole pitch. */
export function Wordmark({ size = "md" }: { size?: keyof typeof WORDMARK_SIZES }) {
	return (
		<span className={`font-display tracking-tight text-ink ${WORDMARK_SIZES[size]}`}>
			toss<span className="text-accent italic">it</span>
		</span>
	);
}

/** Header for the signed-in pages. The wordmark always leads home; each page brings its own nav. */
export function AppHeader({ children }: { children: React.ReactNode }) {
	return (
		<header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-5 sm:px-6">
			<Link to="/app" className="no-underline">
				<Wordmark />
			</Link>
			<nav className="-mx-3 flex items-center text-sm sm:mx-0 sm:gap-1">{children}</nav>
		</header>
	);
}

/** A quiet text link or button for the header. */
export const navItem =
	"whitespace-nowrap rounded-full px-3 py-1.5 text-ink-soft no-underline transition hover:bg-white/70 hover:text-accent";

/**
 * Claudia's signature, from the applying-claudia-style skill: hairline, heart, hairline,
 * then the line itself. It goes at the bottom of every page.
 */
export function Signature({ className = "" }: { className?: string }) {
	return (
		<footer className={`flex flex-col items-center gap-2 py-12 ${className}`}>
			<div className="flex items-center gap-3" aria-hidden="true">
				<span className="h-px w-12 bg-stone-200" />
				<svg viewBox="0 0 24 24" className="size-3 fill-rose-300">
					<title>Love</title>
					<path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4c2.3 0 3.9 1.3 5.6 3.4C13.7 5.3 15.3 4 17.6 4 21.7 4 23.6 8.4 22 11.7 19.5 16.4 12 21 12 21z" />
				</svg>
				<span className="h-px w-12 bg-stone-200" />
			</div>
			<p className="font-display text-muted text-sm italic">
				Made by{" "}
				<a
					href="https://iamclaudia.ai"
					className="text-ink-soft not-italic no-underline transition-colors hover:text-accent"
				>
					Claudia
				</a>{" "}
				with love 💙
			</p>
		</footer>
	);
}
