import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";
import { prepare } from "../scripts/semantic-release.mjs";
import config from "../release.config.mjs";

const logger = { log() {} };

test("release notes use the configured preset and bare version links", async () => {
	const [, options] = config.plugins.find(([name]) => name === "@semantic-release/release-notes-generator");
	const notes = await generateNotes(options, {
		cwd: process.cwd(),
		commits: [
			{ hash: "abc1234", message: "feat: add settings" },
			{ hash: "def5678", message: "fix: correct rendering" },
		],
		lastRelease: { gitTag: "1.0.0" },
		nextRelease: { version: "1.1.0", gitTag: "1.1.0" },
		options: { repositoryUrl: "https://github.com/deepal/obsidian-discussions.git" },
	});
	assert.match(notes, /Features[\s\S]*add settings/);
	assert.match(notes, /Bug Fixes[\s\S]*correct rendering/);
	assert.match(notes, /compare\/1\.0\.0\.\.\.1\.1\.0/);
});

function fixture(t, build = "node build.cjs") {
	const cwd = mkdtempSync(join(tmpdir(), "discussions-release-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const files = {
		"package.json": { name: "release-fixture", version: "0.1.0", scripts: { build } },
		"package-lock.json": { version: "0.1.0", packages: { "": { version: "0.1.0" }, dependency: { version: "3.0.0" } } },
		"manifest.json": { id: "comment-block", version: "0.1.0", minAppVersion: "1.5.0" },
		"versions.json": { "0.1.0": "1.4.0" },
	};
	for (const [file, content] of Object.entries(files)) {
		writeFileSync(join(cwd, file), JSON.stringify(content));
	}
	writeFileSync(join(cwd, "styles.css"), "/* styles */");
	// Assert that the build sees the new version and cannot deploy to a vault.
	writeFileSync(join(cwd, "build.cjs"), `
		const { readFileSync, writeFileSync } = require('node:fs');
		const assert = require('node:assert/strict');
		assert.equal(process.env.OBSIDIAN_PLUGIN_DIR, '');
		assert.equal(process.env.OBSIDIAN_VAULT_DIR, '');
		const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
		writeFileSync('main.js', '/* build for ' + manifest.version + ' */');
	`);
	return {
		cwd,
		env: { ...process.env, OBSIDIAN_PLUGIN_DIR: "/unused", OBSIDIAN_VAULT_DIR: "/unused" },
		nextRelease: { version: "1.0.0" },
		logger,
	};
}

test("release preparation synchronizes versions before building and preserves compatibility history", (t) => {
	const context = fixture(t);
	prepare({}, context);
	const read = (file) => JSON.parse(readFileSync(join(context.cwd, file), "utf8"));
	assert.equal(read("package.json").version, "1.0.0");
	assert.equal(read("package-lock.json").version, "1.0.0");
	assert.equal(read("package-lock.json").packages[""].version, "1.0.0");
	assert.equal(read("package-lock.json").packages.dependency.version, "3.0.0");
	assert.equal(read("manifest.json").version, "1.0.0");
	assert.equal(read("manifest.json").id, "comment-block");
	assert.deepEqual(read("versions.json"), { "0.1.0": "1.4.0", "1.0.0": "1.5.0" });
	assert.match(readFileSync(join(context.cwd, "main.js"), "utf8"), /build for 1\.0\.0/);
});

test("release preparation rejects prefixed, prerelease, and invalid versions without changing files", (t) => {
	const context = fixture(t);
	for (const version of ["v1.0.0", "1.0.0-beta.1", "1.0.0+build", "01.0.0", "1.0"]) {
		assert.throws(() => prepare({}, { ...context, nextRelease: { version } }), /x\.y\.z/);
	}
	assert.equal(JSON.parse(readFileSync(join(context.cwd, "manifest.json"), "utf8")).version, "0.1.0");
});

test("release preparation stops when the build fails", (t) => {
	assert.throws(() => prepare({}, fixture(t, "node -e \"process.exit(1)\"")), /Command failed/);
});

test("release preparation stops when an attachment is empty", (t) => {
	const context = fixture(t);
	writeFileSync(join(context.cwd, "styles.css"), "");
	assert.throws(() => prepare({}, context), /Required release asset is missing or empty: styles\.css/);
});

// Exercise the installed analyzer with the real preset, including the ! syntax.
for (const [message, expected] of [
	["fix: correct rendering", "patch"],
	["feat: add settings", "minor"],
	["feat!: change storage", "major"],
	["refactor: change storage\n\nBREAKING CHANGE: old notes need migration", "major"],
	["docs: update readme", null],
]) {
	test(`semantic version analysis: ${message.split("\n")[0]}`, async () => {
		const [, options] = config.plugins.find(([name]) => name === "@semantic-release/commit-analyzer");
		assert.equal(await analyzeCommits(options, {
			cwd: process.cwd(), commits: [{ hash: "abc123", message }], logger,
		}), expected);
	});
}
