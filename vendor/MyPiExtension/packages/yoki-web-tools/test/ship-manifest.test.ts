import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyShipManifest } from "@yoki/yoki-test-utils";
import { describe, expect, it } from "vitest";

// One level up: this suite lives in `test/`, but the manifest walks the package
// root that owns `package.json`.
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("publish manifest", () => {
	it("`package.json` `files` array covers every production .ts module across the tree", () => {
		expect(verifyShipManifest(PACKAGE_DIR).missing).toEqual([]);
	});
});
