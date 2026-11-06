import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
	stdin: { resolveDir: process.cwd(), contents: 'export { ExplorerBadges } from "./src/explorer-badges.ts"; export { TFile, TFolder } from "obsidian";' },
	bundle: true, platform: "node", format: "esm", write: false,
	plugins: [{ name: "host", setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
		builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
			export class Component {
				loaded = false;
				events = [];
				load() { if (!this.loaded) { this.loaded = true; this.onload(); } }
				unload() {
					if (!this.loaded) return;
					this.loaded = false;
					this.onunload();
					for (const remove of this.events.splice(0)) remove();
				}
				registerEvent(remove) { this.events.push(remove); }
			}
			export class TFile {
				extension = "md";
				stat = { mtime: 1, size: 20 };
				constructor(path) { this.path = path; }
			}
			export class TFolder {}
			export class Vault { static recurseChildren(folder, visit) { folder.children.forEach(visit); } }
			export function setIcon() {}
			export function setTooltip() {}
		` }));
	} }],
});
const { ExplorerBadges, TFile, TFolder } = await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
const cacheKey = "test:explorer-badges";
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(paths) {
	const files = new Map(paths.map(path => [path, new TFile(path)]));
	const local = new Map();
	const layoutReady = [];
	const timers = new Map();
	let timerId = 0;
	function events() {
		const handlers = new Map();
		return {
			on(name, handler) {
				const listeners = handlers.get(name) ?? new Set();
				handlers.set(name, listeners);
				listeners.add(handler);
				return () => listeners.delete(handler);
			},
			emit(name, ...args) {
				for (const handler of handlers.get(name) ?? []) handler(...args);
			},
		};
	}
	const reads = [];
	const app = {
		loadLocalStorage: key => local.get(key),
		saveLocalStorage: (key, value) => local.set(key, structuredClone(value)),
		vault: {
			...events(),
			getMarkdownFiles: () => [...files.values()],
			getFileByPath: path => files.get(path),
			cachedRead: file => new Promise((resolve, reject) => reads.push({ path: file.path, resolve, reject })),
		},
		workspace: {
			...events(),
			onLayoutReady: callback => layoutReady.push(callback),
			getLeavesOfType: () => [],
			containerEl: { win: {
				setTimeout(callback, delay) {
					const id = ++timerId;
					timers.set(id, { callback, delay });
					return id;
				},
				clearTimeout: id => timers.delete(id),
				requestAnimationFrame(callback) {
					const id = ++timerId;
					timers.set(id, { callback, delay: 16 });
					return id;
				},
				cancelAnimationFrame: id => timers.delete(id),
			} },
		},
	};
	return {
		app, files, local, reads,
		feature: () => new ExplorerBadges(app, cacheKey, "test-badge", "message-circle", "Has comments", text => text.includes("comment")),
		layout({ paint = true } = {}) {
			for (const callback of layoutReady.splice(0)) callback();
			if (paint) this.runTimer(16);
		},
		runTimer(delay) {
			const next = Array.from(timers).find(([, timer]) => timer.delay === delay);
			if (!next) return false;
			timers.delete(next[0]);
			next[1].callback();
			return true;
		},
		index: () => local.get(cacheKey)?.entries,
	};
}

test("startup indexes all Markdown files in bounded batches and reuses positive and negative entries", async () => {
	const host = fixture(["A.md", "B.md", "Collapsed/C.md"]);
	const first = host.feature();
	first.setEnabled(true);
	assert.equal(host.runTimer(0), false);
	host.layout();
	host.runTimer(0);
	assert.deepEqual(host.reads.map(read => read.path), ["A.md", "B.md"]);
	assert.equal(host.runTimer(0), false, "both read slots are occupied");
	host.reads[0].resolve("comment");
	host.reads[1].resolve("ordinary text");
	await tick();
	host.runTimer(0);
	host.reads[2].resolve("comment");
	await tick();
	host.runTimer(1000);
	assert.deepEqual(host.index(), [
		["A.md", 1, 20, true], ["B.md", 1, 20, false], ["Collapsed/C.md", 1, 20, true],
	]);
	first.setEnabled(false);

	const warm = host.feature();
	warm.setEnabled(true);
	host.layout();
	assert.equal(host.runTimer(0), false, "no index read for unchanged files");
	const changed = host.files.get("B.md");
	changed.stat.mtime++;
	host.app.vault.emit("modify", changed);
	host.runTimer(0);
	assert.deepEqual(host.reads.slice(3).map(read => read.path), ["B.md"]);
	host.reads[3].resolve("comment");
	await tick();
	warm.setEnabled(false);
	assert.deepEqual(host.index().at(-1), ["B.md", 2, 20, true]);
});

test("results superseded by a save, move, deletion or disable cannot populate the index", async () => {
	const host = fixture(["A.md", "Folder/B.md"]);
	const feature = host.feature();
	feature.setEnabled(true);
	host.layout();
	host.runTimer(0);

	const moved = host.files.get("Folder/B.md");
	moved.path = "Moved/B.md";
	host.files.delete("Folder/B.md");
	host.files.set(moved.path, moved);
	const folder = Object.assign(new TFolder(), { path: "Moved", children: [moved] });
	host.app.vault.emit("rename", folder, "Folder");
	const saved = host.files.get("A.md");
	host.app.vault.emit("modify", saved);
	host.reads[0].resolve("obsolete comment");
	host.reads[1].resolve("obsolete comment");
	await tick();
	host.runTimer(0);
	assert.deepEqual(host.reads.slice(2).map(read => read.path), ["Moved/B.md", "A.md"]);
	host.files.delete(moved.path);
	host.app.vault.emit("delete", moved);
	feature.setEnabled(false);
	feature.setEnabled(true);
	host.layout();
	assert.equal(host.runTimer(0), false, "reads from the old session still occupy their slots");
	host.reads[2].resolve("deleted comment");
	host.reads[3].resolve("stale comment");
	await tick();
	host.runTimer(0);
	host.reads[4].resolve("ordinary text");
	await tick();
	feature.setEnabled(false);
	assert.deepEqual(host.index(), [["A.md", 1, 20, false]]);
});

test("a read failure stays unknown and retries on the next edit", async () => {
	const host = fixture(["A.md"]);
	const feature = host.feature();
	feature.setEnabled(true);
	host.layout();
	host.runTimer(0);
	host.reads[0].reject(Error("temporarily unavailable"));
	await tick();
	assert.equal(host.runTimer(0), false);
	assert.equal(host.index(), undefined);

	host.app.vault.emit("modify", host.files.get("A.md"));
	host.runTimer(0);
	host.reads[1].resolve("comment");
	await tick();
	feature.setEnabled(false);
	assert.deepEqual(host.index(), [["A.md", 1, 20, true]]);
});

test("unavailable device storage leaves the session cache usable across toggles", async () => {
	const host = fixture(["A.md"]);
	const unavailable = () => { throw Error("device storage unavailable"); };
	host.app.loadLocalStorage = unavailable;
	host.app.saveLocalStorage = unavailable;
	const feature = host.feature();
	feature.setEnabled(true);
	host.layout();
	host.runTimer(0);
	host.reads[0].resolve("comment");
	await tick();
	host.runTimer(1000);
	feature.setEnabled(false);
	feature.setEnabled(true);
	host.layout();
	assert.equal(host.runTimer(0), false);
	feature.setEnabled(false);
});

test("startup scans after a bounded wait when the explorer has not painted", () => {
	const host = fixture(["A.md"]);
	const feature = host.feature();
	feature.setEnabled(true);
	host.layout({ paint: false });
	assert.equal(host.runTimer(0), false);
	assert.equal(host.runTimer(250), true);
	assert.equal(host.runTimer(0), true);
	assert.equal(host.reads[0].path, "A.md");
	feature.setEnabled(false);
});
