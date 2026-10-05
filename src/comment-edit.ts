/**
 * Pure helpers for producing and locating `<comment>` source text. No Obsidian
 * dependencies, so they are unit-testable and shared by the reading and
 * live-preview edit paths.
 */

import {
	collectDescendantIds,
	type CommentRegion,
	parseDiscussionRegions,
	parseComments,
	type ParsedComment,
} from "./parser.ts";

/** A single text replacement: replace `[from, to)` with `insert`. */
export interface SourceEdit {
	from: number;
	to: number;
	insert: string;
}

/** Escapes a value for safe use inside a double-quoted HTML attribute. */
function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export interface NewComment {
	id: string;
	author: string;
	/** Omitted for a top-level comment; set to link a reply to its target. */
	parentId?: string;
	/** Body text; defaults to empty (caret is placed inside by the caller). */
	body?: string;
}

/**
 * Renders a single `<comment>` block. The body sits on its own line so the
 * source stays readable and the closing tag begins a fresh line (a bare
 * `</comment>` on its own line is what makes Obsidian treat the block as raw
 * HTML rather than inline markup).
 */
export function newCommentBlock(c: NewComment): string {
	const attrs = [`id="${escapeAttr(c.id)}"`];
	if (c.parentId) attrs.push(`parent_id="${escapeAttr(c.parentId)}"`);
	attrs.push(`author="${escapeAttr(c.author)}"`);
	return `<comment ${attrs.join(" ")}>\n${c.body ?? ""}\n</comment>`;
}

/** Source for a new discussion whose first comment is ready to edit. */
export function newDiscussionBlock(c: NewComment): string {
	return `<discussion>\n${newCommentBlock(c)}\n</discussion>`;
}

/**
 * Builds the edit that appends a reply to the region containing `target`. The
 * new block is stacked at the region's tail (not directly under the target) so
 * the "comments live at the bottom" convention holds regardless of which
 * comment was replied to; nesting is expressed via the reply's `parent_id`.
 * Returns null if the target's region can no longer be found.
 */
export function replyEdit(
	text: string,
	target: ParsedComment,
	reply: NewComment
): SourceEdit | null {
	const region = findRegion(text, target);
	if (!region) return null;
	return addCommentEdit(text, region, reply);
}

/** Appends a comment to a panel, including an empty wrapper. */
export function addCommentEdit(
	text: string,
	region: CommentRegion,
	comment: NewComment
): SourceEdit | null {
	const fresh = locateRegion(text, region);
	if (!fresh) return null;
	const block = newCommentBlock(comment);
	if (!fresh.wrapped) {
		return { from: fresh.to, to: fresh.to, insert: `\n\n${block}` };
	}
	if (fresh.comments.length === 0) {
		return { from: fresh.bodyFrom, to: fresh.bodyTo, insert: `\n${block}\n` };
	}
	const last = fresh.comments[fresh.comments.length - 1];
	return { from: last.to, to: last.to, insert: `\n\n${block}` };
}

/** Finds the region containing `target` in the current text, matched by id. */
function findRegion(text: string, target: ParsedComment): CommentRegion | null {
	const c = locate(text, target);
	if (!c) return null;
	return (
		parseDiscussionRegions(text).find((r) =>
			r.comments.some((rc) => rc.from === c.from)
		) ?? null
	);
}

/** Resolves a panel against current source, using a comment id when possible. */
function locateRegion(text: string, region: CommentRegion): CommentRegion | null {
	const regions = parseDiscussionRegions(text);
	const anchor = region.comments.find((c) => c.id);
	if (anchor) {
		return regions.find((r) => r.comments.some((c) => c.id === anchor.id)) ?? null;
	}
	return regions.find((r) =>
		r.from === region.from &&
		r.to === region.to &&
		r.wrapped === region.wrapped &&
		(r.comments.length === 0 || r.comments[0].body === region.comments[0]?.body)
	) ?? null;
}

/**
 * Locates a comment in the current text, preferring a match by `id` so the
 * edit stays correct even if the note changed since the panel was rendered.
 * Falls back to the render-time comment (matched by offset) for id-less
 * hand-written comments.
 */
function locate(text: string, comment: ParsedComment): ParsedComment | null {
	const fresh = parseComments(text);
	if (comment.id) return fresh.find((c) => c.id === comment.id) ?? null;
	return fresh.find((c) => c.from === comment.from && c.body === comment.body) ?? null;
}

/**
 * Builds the edit that replaces a comment's body in place, leaving its opening
 * tag (id, author, parent_id) untouched. Returns null if the comment can no
 * longer be found.
 */
export function editBodyEdit(
	text: string,
	comment: ParsedComment,
	newBody: string
): SourceEdit | null {
	const c = locate(text, comment);
	if (!c) return null;
	return { from: c.bodyFrom, to: c.bodyTo, insert: `\n${newBody}\n` };
}

/**
 * Builds the edit that deletes a comment and its entire reply subtree. When the
 * deletion empties the region, an empty discussion wrapper remains. Otherwise
 * surviving comments are kept verbatim and re-joined with blank lines.
 */
export function deleteCommentEdit(
	text: string,
	comment: ParsedComment
): SourceEdit | null {
	const c = locate(text, comment);
	if (!c) return null;

	const region = parseDiscussionRegions(text).find((r) =>
		r.comments.some((rc) => rc.from === c.from)
	);
	if (!region) return null;

	const remove = c.id
		? collectDescendantIds(region.comments, c.id)
		: new Set<string>();
	const kept = region.comments.filter((rc) =>
		c.id ? !(rc.id && remove.has(rc.id)) : rc.from !== c.from
	);

	if (kept.length === 0) {
		return { from: region.from, to: region.to, insert: "<discussion></discussion>" };
	}

	const rebuilt = kept.map((rc) => text.slice(rc.from, rc.to)).join("\n\n");
	if (region.wrapped) {
		return { from: region.bodyFrom, to: region.bodyTo, insert: `\n${rebuilt}\n` };
	}
	return { from: region.from, to: region.to, insert: rebuilt };
}

/** Removes a complete discussion, including its wrapper if present. */
export function deleteDiscussionEdit(
	text: string,
	region: CommentRegion
): SourceEdit | null {
	const fresh = locateRegion(text, region);
	if (!fresh) return null;
	const before = text.slice(0, fresh.from);
	const lead = /\s+$/.exec(before);
	const from = lead ? fresh.from - lead[0].length : fresh.from;
	return { from, to: fresh.to, insert: "" };
}
