import { Link } from "react-router";

// The mark is sized to sit on the wordmark's baseline and rise to its cap height.
const SIZES = {
	md: { text: "text-2xl", mark: "size-8", gap: "gap-1" },
	lg: { text: "text-6xl sm:text-7xl", mark: "size-16 sm:size-20", gap: "gap-2" },
};

/**
 * The toss: a dashed arc with the ball at its end, as in the drop zone and the favicon
 * (public/favicon.svg, a bolder copy on a tile). With `arrive`, the ball flies in along the arc once.
 */
export function TossMark({
	className = "size-8",
	arrive = false,
}: {
	className?: string;
	arrive?: boolean;
}) {
	return (
		<svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
			<title>tossit</title>
			<path
				d="M6 36C10 16 24 8 42 12"
				stroke="var(--color-violet-400)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="3 4.5"
			/>
			<circle
				cx="42"
				cy="12"
				r="5"
				fill="var(--color-rose-400)"
				// motion-reduce: the theme's rule shortens the animation, but Chrome still paints its
				// first keyframe for one frame, which would flash the ball at the arc's start.
				className={arrive ? "animate-arrive motion-reduce:animate-none" : undefined}
			/>
		</svg>
	);
}

/**
 * tossit's brand: the mark beside the wordmark, everywhere the name appears. `arrive` plays the
 * toss on pages people land on; the signed-in header leaves it still, since it remounts on
 * every navigation.
 */
export function Logo({
	size = "md",
	arrive = false,
}: {
	size?: keyof typeof SIZES;
	arrive?: boolean;
}) {
	const { text, mark, gap } = SIZES[size];
	return (
		<span className={`inline-flex items-end ${gap}`}>
			<TossMark className={mark} arrive={arrive} />
			{/* "toss" in Newsreader with the "it" in italic violet: the name is the whole pitch. */}
			<span className={`font-display tracking-tight text-ink ${text}`}>
				toss<span className="text-accent italic">it</span>
			</span>
		</span>
	);
}

/** Header for the signed-in pages. The logo always leads home; each page brings its own nav. */
export function AppHeader({ children }: { children: React.ReactNode }) {
	return (
		<header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-5 sm:px-6">
			{/* relative: on a tight row the nav's hover background reaches the "it"; keep the logo on top. */}
			<Link to="/app" className="relative no-underline">
				<Logo />
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
