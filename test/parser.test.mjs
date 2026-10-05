import { test } from "node:test";
import assert from "node:assert/strict";

// Import the TS source directly via Node's type-stripping (see package.json test script).
import {
	parseComments,
	groupRegions,
	parseDiscussionRegions,
	buildForest,
} from "../src/parser.ts";

test("parses a single comment's attributes and body", () => {
	const text = `<comment id="1" author="bob">\nhello world\n</comment>`;
	const [c] = parseComments(text);
	assert.equal(c.id, "1");
	assert.equal(c.author, "bob");
	assert.equal(c.parentId, null);
	assert.equal(c.body, "hello world");
});

test("empty wrapper creates a discussion region", () => {
	const text = "Before\n\n<discussion></discussion>";
	const [region] = parseDiscussionRegions(text);
	assert.equal(region.wrapped, true);
	assert.equal(region.comments.length, 0);
	assert.equal(text.slice(region.from, region.to), "<discussion></discussion>");
});

test("wrapped comments stay in separate adjacent discussions", () => {
	const text =
		"<discussion><comment id=\"1\" author=\"a\">one</comment></discussion>\n" +
		"<discussion><comment id=\"2\" author=\"b\">two</comment></discussion>";
	const regions = parseDiscussionRegions(text);
	assert.equal(regions.length, 2);
	assert.deepEqual(regions.map((r) => r.comments.map((c) => c.id)), [["1"], ["2"]]);
});

test("legacy comments still form a region beside a wrapper", () => {
	const text =
		"<comment id=\"1\" author=\"a\">one</comment>\n\n" +
		"<discussion></discussion>\n\n" +
		"<comment id=\"2\" author=\"b\">two</comment>";
	const regions = parseDiscussionRegions(text);
	assert.deepEqual(regions.map((r) => [r.wrapped, r.comments.length]), [
		[false, 1], [true, 0], [false, 1],
	]);
});

test("wrappers in code and wrappers containing prose are not claimed", () => {
	const text =
		"```\n<discussion></discussion>\n```\n\n" +
		"`<discussion></discussion>`\n\n" +
		"<discussion>Prose <comment id=\"1\" author=\"a\">one</comment></discussion>";
	const regions = parseDiscussionRegions(text);
	assert.equal(regions.length, 0);
});

test("a discussion-looking tag in a comment body does not split its wrapper", () => {
	const text = `<discussion><comment id="1" author="a">Use <discussion> in docs</comment></discussion>`;
	const regions = parseDiscussionRegions(text);
	assert.equal(regions.length, 1);
	assert.equal(regions[0].comments[0].id, "1");
});

test("parses parent_id for replies", () => {
	const text =
		`<comment id="1" author="bob">a</comment>\n` +
		`<comment id="2" parent_id="1" author="alice">b</comment>`;
	const [a, b] = parseComments(text);
	assert.equal(a.parentId, null);
	assert.equal(b.parentId, "1");
	assert.equal(b.author, "alice");
});

test("ignores comment tags inside fenced code blocks", () => {
	const text =
		"```\n" +
		`<comment id="1" author="bob">nope</comment>\n` +
		"```\n" +
		`<comment id="2" author="alice">yes</comment>`;
	const comments = parseComments(text);
	assert.equal(comments.length, 1);
	assert.equal(comments[0].id, "2");
});

test("ignores comment tags inside inline code", () => {
	const text = "text `<comment id=\"1\" author=\"x\">no</comment>` more";
	assert.equal(parseComments(text).length, 0);
});

test("an unbalanced backtick above does not swallow later comments", () => {
	// A lone/odd backtick in prose must not pair with a backtick inside a later
	// comment body and hide the whole block (inline spans are single-line only).
	const text =
		"Prose with an `unclosed backtick and inline `code` here.\n\n" +
		`<comment id="1" author="bob">uses \`origin/main\` value</comment>\n` +
		`<comment id="2" parent_id="1" author="alice">also \`:8889\` port</comment>`;
	const comments = parseComments(text);
	assert.equal(comments.length, 2);
	assert.equal(comments[0].id, "1");
	assert.equal(comments[1].id, "2");
});

test("attribute order is irrelevant", () => {
	const text = `<comment author="bob" parent_id="1" id="2">hi</comment>`;
	const [c] = parseComments(text);
	assert.equal(c.id, "2");
	assert.equal(c.parentId, "1");
	assert.equal(c.author, "bob");
});

test("groups whitespace-separated comments into one region", () => {
	const text =
		`<comment id="1" author="bob">a</comment>\n\n` +
		`<comment id="2" author="alice">b</comment>`;
	const regions = groupRegions(parseComments(text), text);
	assert.equal(regions.length, 1);
	assert.equal(regions[0].comments.length, 2);
});

test("prose between comments starts a new region", () => {
	const text =
		`<comment id="1" author="bob">a</comment>\n\n` +
		`Some prose.\n\n` +
		`<comment id="2" author="alice">b</comment>`;
	const regions = groupRegions(parseComments(text), text);
	assert.equal(regions.length, 2);
});

test("buildForest nests replies under parents", () => {
	const text =
		`<comment id="1" author="bob">root</comment>\n` +
		`<comment id="2" parent_id="1" author="alice">reply</comment>\n` +
		`<comment id="3" parent_id="2" author="bob">nested</comment>`;
	const forest = buildForest(parseComments(text));
	assert.equal(forest.length, 1);
	assert.equal(forest[0].comment.id, "1");
	assert.equal(forest[0].children.length, 1);
	assert.equal(forest[0].children[0].comment.id, "2");
	assert.equal(forest[0].children[0].children[0].comment.id, "3");
});

test("buildForest orders replies chronologically by id, newest last", () => {
	// Replies to the same parent appear out of id order in the source; the forest
	// must still present them oldest-first (newest at the bottom).
	const text =
		`<comment id="100" author="bob">root</comment>\n` +
		`<comment id="300" parent_id="100" author="c">newest</comment>\n` +
		`<comment id="200" parent_id="100" author="a">middle</comment>`;
	const forest = buildForest(parseComments(text));
	assert.deepEqual(
		forest[0].children.map((n) => n.comment.id),
		["200", "300"]
	);
});

test("buildForest treats an unknown parent as a root", () => {
	const text = `<comment id="2" parent_id="999" author="alice">orphan</comment>`;
	const forest = buildForest(parseComments(text));
	assert.equal(forest.length, 1);
	assert.equal(forest[0].comment.id, "2");
});

test("buildForest keeps a forward-referencing parent from dropping a comment", () => {
	// parent appears after the child in document order.
	const text =
		`<comment id="2" parent_id="1" author="alice">child-first</comment>\n` +
		`<comment id="1" author="bob">parent-later</comment>`;
	const forest = buildForest(parseComments(text));
	// Both must be reachable; neither silently vanishes.
	const ids = [];
	const walk = (nodes) => nodes.forEach((n) => (ids.push(n.comment.id), walk(n.children)));
	walk(forest);
	assert.deepEqual(ids.sort(), ["1", "2"]);
});
