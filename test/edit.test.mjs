import { test } from "node:test";
import assert from "node:assert/strict";

import { parseComments, parseDiscussionRegions, collectDescendantIds } from "../src/parser.ts";
import {
	addCommentEdit,
	deleteDiscussionEdit,
	editBodyEdit,
	deleteCommentEdit,
	newDiscussionBlock,
	replyEdit,
} from "../src/comment-edit.ts";

/** Applies a SourceEdit to text (mirrors what the layers do). */
function apply(text, edit) {
	assert.ok(edit, "expected an edit");
	return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

const THREAD =
	`<comment id="1" author="bob">root</comment>\n\n` +
	`<comment id="2" parent_id="1" author="alice">reply</comment>\n\n` +
	`<comment id="3" parent_id="2" author="bob">nested</comment>`;

test("collectDescendantIds gathers the whole subtree", () => {
	const ids = collectDescendantIds(parseComments(THREAD), "1");
	assert.deepEqual([...ids].sort(), ["1", "2", "3"]);
});

test("collectDescendantIds from a mid-node excludes ancestors", () => {
	const ids = collectDescendantIds(parseComments(THREAD), "2");
	assert.deepEqual([...ids].sort(), ["2", "3"]);
});

test("editBodyEdit replaces only the targeted comment's body", () => {
	const [, second] = parseComments(THREAD);
	const out = apply(THREAD, editBodyEdit(THREAD, second, "edited text"));
	const reparsed = parseComments(out);
	assert.equal(reparsed[1].body, "edited text");
	// Neighbours are untouched.
	assert.equal(reparsed[0].body, "root");
	assert.equal(reparsed[2].body, "nested");
	// Attributes are preserved.
	assert.equal(reparsed[1].id, "2");
	assert.equal(reparsed[1].parentId, "1");
	assert.equal(reparsed[1].author, "alice");
});

test("deleteCommentEdit cascades to descendants", () => {
	const [root] = parseComments(THREAD);
	const out = apply(THREAD, deleteCommentEdit(THREAD, root)).trim();
	assert.equal(parseComments(out).length, 0);
});

test("deleteCommentEdit of a leaf keeps siblings and ancestors", () => {
	const [, , leaf] = parseComments(THREAD);
	const out = apply(THREAD, deleteCommentEdit(THREAD, leaf));
	const ids = parseComments(out).map((c) => c.id).sort();
	assert.deepEqual(ids, ["1", "2"]);
});

test("deleteCommentEdit of a mid-node removes it and its child", () => {
	const [, mid] = parseComments(THREAD);
	const out = apply(THREAD, deleteCommentEdit(THREAD, mid));
	const ids = parseComments(out).map((c) => c.id);
	assert.deepEqual(ids, ["1"]);
});

test("replyEdit appends a reply at the region tail", () => {
	const [root] = parseComments(THREAD);
	const out = apply(
		THREAD,
		replyEdit(THREAD, root, {
			id: "4",
			author: "carol",
			parentId: "1",
			body: "new reply",
		})
	);
	const comments = parseComments(out);
	assert.equal(comments.length, 4);
	const added = comments.find((c) => c.id === "4");
	assert.equal(added.parentId, "1");
	assert.equal(added.body, "new reply");
	// Appended after the last existing comment in the region.
	assert.equal(comments[comments.length - 1].id, "4");
});

test("edits made against surrounding prose leave the prose intact", () => {
	const doc = `# Notes\n\nSome prose.\n\n${THREAD}\n`;
	const [root] = parseComments(doc);
	const out = apply(doc, editBodyEdit(doc, root, "changed"));
	assert.ok(out.startsWith("# Notes\n\nSome prose.\n\n"));
	assert.equal(parseComments(out)[0].body, "changed");
});

test("adding the first comment to an empty wrapper keeps it inside", () => {
	const text = "# Note\n\n<discussion></discussion>\n";
	const [region] = parseDiscussionRegions(text);
	const out = apply(text, addCommentEdit(text, region, {
		id: "5", author: "bob", body: "first",
	}));
	assert.equal(parseDiscussionRegions(out)[0].comments[0].body, "first");
	assert.match(out, /<discussion>\n<comment[\s\S]*<\/comment>\n<\/discussion>/);
});

test("adding to a populated wrapper stays before its closing tag", () => {
	const text = `<discussion>\n${THREAD}\n</discussion>`;
	const [region] = parseDiscussionRegions(text);
	const out = apply(text, addCommentEdit(text, region, {
		id: "4", author: "carol", body: "another",
	}));
	assert.deepEqual(parseDiscussionRegions(out)[0].comments.map((c) => c.id), ["1", "2", "3", "4"]);
});

test("replying in a wrapped panel keeps the reply inside it", () => {
	const text = `<discussion>\n${THREAD}\n</discussion>`;
	const [root] = parseComments(text);
	const out = apply(text, replyEdit(text, root, {
		id: "4", author: "carol", parentId: "1", body: "reply",
	}));
	const [region] = parseDiscussionRegions(out);
	assert.equal(region.comments.length, 4);
	assert.equal(region.comments[3].parentId, "1");
});

test("deleting the last wrapped comment leaves an empty discussion", () => {
	const text = `<discussion>\n<comment id="1" author="bob">hello</comment>\n</discussion>`;
	const out = apply(text, deleteCommentEdit(text, parseComments(text)[0]));
	assert.equal(out, "<discussion></discussion>");
	assert.equal(parseDiscussionRegions(out)[0].comments.length, 0);
});

test("deleting the last legacy comment converts it to an empty wrapper", () => {
	const text = `# Note\n\n<comment id="1" author="bob">hello</comment>\n`;
	const out = apply(text, deleteCommentEdit(text, parseComments(text)[0]));
	assert.equal(out, "# Note\n\n<discussion></discussion>\n");
});

test("delete discussion removes a wrapped or legacy panel without touching prose", () => {
	for (const panel of ["<discussion></discussion>", THREAD]) {
		const text = `Before\n\n${panel}\n\nAfter`;
		const [region] = parseDiscussionRegions(text);
		const out = apply(text, deleteDiscussionEdit(text, region));
		assert.equal(out, "Before\n\nAfter");
	}
});

test("deleting one adjacent discussion leaves its neighbour intact", () => {
	const text = "<discussion></discussion>\n\n<discussion></discussion>";
	const [first] = parseDiscussionRegions(text);
	const out = apply(text, deleteDiscussionEdit(text, first));
	assert.equal(out.trim(), "<discussion></discussion>");
	assert.equal(parseDiscussionRegions(out).length, 1);
});

test("new discussion command source wraps its first comment", () => {
	const text = newDiscussionBlock({ id: "5", author: "bob" });
	assert.equal(parseDiscussionRegions(text)[0].comments.length, 1);
	assert.match(text, /^<discussion>\n<comment[\s\S]*<\/comment>\n<\/discussion>$/);
});
