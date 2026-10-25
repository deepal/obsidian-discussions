import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const hostCode = `
 export class Component {
  load() { this.onload?.(); }
  addChild(child) { return child; }
  registerEvent() {}
 }
 export class Plugin extends Component {
  commands = []; extensions = [];
  constructor(app) { super(); this.app = app; }
  async loadData() { return null; }
  registerEditorExtension(extension) { this.extensions.push(extension); }
  registerMarkdownPostProcessor() {}
  addSettingTab() {}
  addCommand(command) { this.commands.push(command); }
 }
 export class PluginSettingTab {}
 export class MarkdownView {} export class MarkdownRenderChild {}
 export class TFile {} export class Notice {}
 export class Menu {} export class Scope {}
 export const MarkdownRenderer = {};
 export function setIcon() {}
 import { StateField } from '@codemirror/state';
 export const editorInfoField = StateField.define({
  create: () => ({file: {path: 'Note.md'}}), update: value => value,
 });
`;
const bundle = await build({
	stdin: {
		contents: `export { default as Plugin } from './src/main.ts';
export { EditorState } from '@codemirror/state';
export { parseDiscussionRegions } from './src/parser.ts';
export { addCommentEdit } from './src/comment-edit.ts';`,
		resolveDir: process.cwd(),
	},
	bundle: true, platform: "node", format: "esm", write: false,
	plugins: [{ name: "host", setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
		builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: hostCode, resolveDir: process.cwd() }));
	} }],
});
const { Plugin, EditorState, parseDiscussionRegions, addCommentEdit } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
globalThis.document = { body: { classList: { toggle() {} } } };

async function fixture(doc, cursor) {
	const events = { on() { return {}; }, trigger() {} };
	const plugin = new Plugin({ workspace: events, vault: events });
	await plugin.onload();
	assert.equal(plugin.commands.length, 1);
	const command = plugin.commands[0];
	assert.equal(command.id, "start-discussion");
	const field = plugin.extensions[1];
	let state = EditorState.create({
		doc, extensions: [field],
		selection: { anchor: offset(cursor, EditorState.create({ doc }).doc) },
	});
	let transactions = 0;
	let focused = false;
	const editor = {
		getCursor() {
			const line = state.doc.lineAt(state.selection.main.head);
			return { line: line.number - 1, ch: state.selection.main.head - line.from };
		},
		getLine(line) { return state.doc.line(line + 1).text; },
		lastLine() { return state.doc.lines - 1; },
		focus() { focused = true; },
		transaction(tx) {
			transactions++;
			const changes = state.changes(tx.changes.map(change => ({
				from: offset(change.from, state.doc),
				to: offset(change.to ?? change.from, state.doc),
				insert: change.text,
			})));
			const nextDoc = changes.apply(state.doc);
			state = state.update({ changes, selection: {
				anchor: offset(tx.selection.from, nextDoc),
				head: offset(tx.selection.to ?? tx.selection.from, nextDoc),
			} }).state;
		},
	};
	return {
		plugin, editor, start: () => command.editorCallback(editor),
		state: () => state, panels: () => state.field(field).size,
		transactions: () => transactions, focused: () => focused,
		apply(edit) {
			state = state.update({ changes: { from: edit.from, to: edit.to, insert: edit.insert } }).state;
		},
		move(anchor) { state = state.update({ selection: { anchor } }).state; },
	};
}

function offset(position, doc) {
	return doc.line(position.line + 1).from + position.ch;
}

const wrapper = "<discussion></discussion>";
for (const scenario of [
	{ name: "empty note", doc: "", cursor: { line: 0, ch: 0 }, expected: `${wrapper}\n\n` },
	{ name: "blank line between paragraphs", doc: "Before\n\nAfter", cursor: { line: 1, ch: 0 }, expected: `Before\n\n${wrapper}\n\nAfter` },
	{ name: "start of prose", doc: "After", cursor: { line: 0, ch: 0 }, expected: `${wrapper}\n\nAfter` },
	{ name: "start of a line after prose", doc: "Before\nAfter", cursor: { line: 1, ch: 0 }, expected: `Before\n\n${wrapper}\n\nAfter` },
	{ name: "end of prose", doc: "Before", cursor: { line: 0, ch: 6 }, expected: `Before\n\n${wrapper}\n\n` },
	{ name: "end of a line before prose", doc: "Before\nAfter", cursor: { line: 0, ch: 6 }, expected: `Before\n\n${wrapper}\n\nAfter` },
	{ name: "middle of prose", doc: "BeforeAfter", cursor: { line: 0, ch: 6 }, expected: `Before\n\n${wrapper}\n\nAfter` },
	{ name: "whitespace blank line", doc: "Before\n  \nAfter", cursor: { line: 2, ch: 0 }, expected: `Before\n  \n${wrapper}\n\nAfter` },
]) {
	test(`start discussion renders immediately for ${scenario.name}`, async () => {
		const f = await fixture(scenario.doc, scenario.cursor);
		f.plugin.newId = () => assert.fail("creation must not allocate a comment id");
		f.plugin.authorName = () => assert.fail("creation must not stamp a comment author");
		f.start();
		const state = f.state();
		assert.equal(state.doc.toString(), scenario.expected);
		const [region] = parseDiscussionRegions(state.doc.toString());
		assert.equal(region.comments.length, 0);
		assert.ok(state.selection.main.empty);
		assert.equal(state.doc.lineAt(state.selection.main.head).text, "");
		assert.ok(state.selection.main.head > region.to);
		assert.equal(f.panels(), 1);
		assert.equal(f.transactions(), 1);
		assert.equal(f.focused(), true);
	});
}

test("repeated commands create separate rendered empty discussions", async () => {
	const f = await fixture("", { line: 0, ch: 0 });
	f.start();
	f.start();
	assert.equal(f.state().doc.toString(), `${wrapper}\n\n${wrapper}\n\n`);
	assert.equal(parseDiscussionRegions(f.state().doc.toString()).length, 2);
	assert.equal(f.panels(), 2);
	assert.equal(f.transactions(), 2);
});

test("adding the first comment keeps the newly created panel rendered", async () => {
	const f = await fixture("", { line: 0, ch: 0 });
	f.start();
	const text = f.state().doc.toString();
	const [region] = parseDiscussionRegions(text);
	f.apply(addCommentEdit(text, region, { id: "1", author: "Alice", body: "First comment" }));
	const [updated] = parseDiscussionRegions(f.state().doc.toString());
	assert.equal(updated.comments.length, 1);
	assert.equal(updated.comments[0].body, "First comment");
	assert.equal(f.panels(), 1);
});

test("moving into the discussion still exposes its source", async () => {
	const f = await fixture("", { line: 0, ch: 0 });
	f.start();
	f.move(1);
	assert.equal(f.panels(), 0);
});

test("rendering remains disabled when comment threads are disabled", async () => {
	const f = await fixture("", { line: 0, ch: 0 });
	f.plugin.settings = { ...f.plugin.settings, enabled: false };
	f.start();
	assert.equal(f.state().doc.toString(), `${wrapper}\n\n`);
	assert.equal(f.panels(), 0);
});
