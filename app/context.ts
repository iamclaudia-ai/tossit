import { createContext } from "react-router";

/**
 * The Worker's bindings and execution context, handed to every loader, action and
 * middleware. React Router v8 always runs with middleware, so request context is a
 * `RouterContextProvider` keyed by typed contexts rather than a plain load-context object:
 * `workers/app.ts` sets this one per request, and routes read it with
 * `context.get(cloudflareContext)`.
 */
export const cloudflareContext = createContext<{
	env: Env;
	ctx: ExecutionContext;
}>();
