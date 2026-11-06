import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSettings, DEFAULT_SETTINGS } from "../src/settings-data.ts";

test("missing or invalid stored settings fall back to defaults", () => {
	for (const value of [undefined, null, [], "invalid", 42]) {
		assert.deepEqual(normalizeSettings(value), DEFAULT_SETTINGS);
	}
});

test("valid settings survive while malformed values and unknown keys are discarded", () => {
	assert.deepEqual(normalizeSettings({ username: "  Alice  ", enabled: false, renderMarkdown: "yes", extra: true }), {
		username: "Alice", enabled: false, renderMarkdown: true, showExplorerBadges: false,
	});
});

test("Explorer badges are opt-in and independent of the rendering toggle", () => {
	assert.equal(normalizeSettings({}).showExplorerBadges, false);
	assert.equal(normalizeSettings({ showExplorerBadges: "true" }).showExplorerBadges, false);
	assert.equal(normalizeSettings({ enabled: false, showExplorerBadges: true }).showExplorerBadges, true);
});
