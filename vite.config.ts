import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	server: {
		allowedHosts: true,
	},
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter(),
		// Without an explicit root the plugin crawls Vite's *workspace* root for tsconfig
		// files, and a stray pnpm-workspace.yaml or workspaces package.json above the repo
		// (e.g. in $HOME) turns that into a crawl of the whole home directory.
		tsconfigPaths({ root: import.meta.dirname }),
	],
});
