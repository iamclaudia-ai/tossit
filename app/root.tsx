import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router";

import { Signature, Wordmark } from "~/components/brand";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
	// The toss mark. Browsers that read SVG icons take the first; favicon.ico (16/32/48) is the
	// fallback, and iOS takes the square apple-touch-icon and rounds it itself.
	{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
	{ rel: "icon", href: "/favicon.ico", sizes: "48x48" },
	{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		// Newsreader carries the voice (wordmark, titles, the signature); UI text is the system
		// sans. Same font and URL as Anima, per the applying-claudia-style skill.
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<meta name="theme-color" content="#faf9f7" />
				<Meta />
				<Links />
			</head>
			<body className="min-h-dvh bg-claudia text-ink">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Oops!";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "404" : "Error";
		details =
			error.status === 404
				? "The requested page could not be found."
				: error.statusText || details;
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-4 py-16">
			<div className="w-full max-w-xl text-center">
				<Wordmark />
				<h1 className="mt-8 font-display text-5xl text-ink tracking-tight">{message}</h1>
				<p className="mt-3 font-display text-lg text-muted italic">{details}</p>
				{stack && (
					<pre className="mt-8 w-full overflow-x-auto rounded-2xl bg-stone-900 p-4 text-left text-stone-100 text-xs">
						<code>{stack}</code>
					</pre>
				)}
			</div>
			<Signature />
		</main>
	);
}
