import { defineConfig } from "vitest/config";

export default defineConfig({
	// Vite's default cacheDir is `<root>/node_modules/.vite`, so with this package as
	// root the cache dir alone trips scripts/check-no-nested-node-modules.mjs.
	cacheDir: "../../node_modules/.vite/yoki-newapi",
	test: {
		include: ["test/**/*.test.ts"],
	},
});
