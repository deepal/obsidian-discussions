/**
 * Pure parsing utilities for `<comment>` blocks.
 *
 * This module has no Obsidian dependencies so it can be unit-tested in plain
 * Node. It is the single source of truth for comment offsets, line numbers,
 * attributes and body — shared by the reading path, the live-preview path and
 * the reply/insert helpers.
 *
 * The `<comment>` tags are treated purely as a storage syntax: parsing reads
 * the raw note text directly and never relies on Obsidian's HTML rendering,
 * which would otherwise sanitise away unknown elements.
 */

export interface ParsedComment {
	/** Char offset of the opening `<comment` in the source text. */
	from: number;
	/** Char offset just past the closing `</comment>`. */
	to: number;
	/** 0-based line of the opening tag. */
	lineStart: number;
	/** 0-based line of the closing tag. */
	lineEnd: number;
	/** `id` attribute — identity and (as a `Date.now()` value) creation time. */
	id: string | null;
	/** `parent_id` attribute linking a reply to the comment it answers, else null. */
	parentId: string | null;
	/** `author` attribute, else null. */
	author: string | null;
	/** Char offset of the raw inner content (just past the opening `>`). */
	bodyFrom: number;
	/** Char offset of the raw inner content end (just before `</comment>`). */
	bodyTo: number;
	/** Inner text with the surrounding tags stripped and outer whitespace trimmed. */
	body: string;
}

/** A contiguous run of comment blocks rendered together as one thread panel. */
export interface CommentRegion {
	comments: ParsedComment[];
	/** Whether an explicit `<discussion>` owns this panel. */
	wrapped: boolean;
	/** Char offset of the region's first opening tag. */
	from: number;
	/** Char offset just past the region's last closing tag. */
	to: number;
	/** The editable space inside a wrapper (or the whole legacy region). */
	bodyFrom: number;
	bodyTo: number;
	/** 0-based line of the region's first opening tag. */
	lineStart: number;
	/** 0-based line of the region's last closing tag. */
	lineEnd: number;
}

/** A comment plus its replies, assembled into a tree for rendering. */
export interface CommentNode {
	comment: ParsedComment;
	children: CommentNode[];
}

/**
 * Returns char ranges `[start, end)` that should be treated as code (fenced
 * code blocks and inline code spans) so `<comment>` inside them is ignored.
 */
function findCodeRanges(text: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];

	// Fenced code blocks: ``` or ~~~ fences (allow leading whitespace). The
	// block runs to a matching closing fence line, or to end-of-input if the
	// fence is never closed (`(?![\s\S])` asserts end of string).
	const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
	let m: RegExpExecArray | null;
	while ((m = fence.exec(text)) !== null) {
		ranges.push([m.index, m.index + m[0].length]);
	}

	// Inline code spans: matched runs of backticks on a single line. Restricted
	// to a single line (`[^\n]`) so an unbalanced backtick can't pair with one
	// lines away and engulf a whole region (e.g. `<comment>` blocks below it).
	const inline = /(`+)(?:(?!\1)[^\n])*?\1/g;
	while ((m = inline.exec(text)) !== null) {
		const start = m.index;
		const end = start + m[0].length;
		if (!ranges.some(([s, e]) => start >= s && end <= e)) {
			ranges.push([start, end]);
		}
	}

	return ranges;
}

function isInside(ranges: Array<[number, number]>, pos: number): boolean {
	return ranges.some(([s, e]) => pos >= s && pos < e);
}

/** Builds a function mapping a char offset to its 0-based line number. */
function makeLineLookup(text: string): (offset: number) => number {
	const lineStarts: number[] = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") lineStarts.push(i + 1);
	}
	return (offset: number) => {
		// Binary search for the greatest lineStart <= offset.
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};
}

const ATTR_RE = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g;

/** Parses `name="value"` pairs from a tag's attribute string. */
function parseAttrs(attrs: string): Record<string, string> {
	const out: Record<string, string> = {};
	let m: RegExpExecArray | null;
	ATTR_RE.lastIndex = 0;
	while ((m = ATTR_RE.exec(attrs)) !== null) {
		out[m[1].toLowerCase()] = m[2];
	}
	return out;
}

// Opening tag, its attributes, the body, then the closing tag. The body match
// is lazy so nested/stacked comments each parse as their own block; genuine
// tree structure is expressed via `parent_id`, never by physical nesting.
const COMMENT_RE = /<comment\b([^>]*)>([\s\S]*?)<\/comment\s*>/gi;

/**
 * Parses all `<comment>...</comment>` blocks in `text`, skipping any that fall
 * inside fenced code blocks or inline code spans. Results are in document
 * order.
 */
export function parseComments(text: string): ParsedComment[] {
	const codeRanges = findCodeRanges(text);
	const lineOf = makeLineLookup(text);
	const comments: ParsedComment[] = [];

	let m: RegExpExecArray | null;
	COMMENT_RE.lastIndex = 0;
	while ((m = COMMENT_RE.exec(text)) !== null) {
		const from = m.index;
		const to = from + m[0].length;
		if (isInside(codeRanges, from)) continue;

		const attrs = parseAttrs(m[1]);
		// The first `>` closes the opening tag (attribute values hold no `>`); the
		// last `</` opens the closing tag. Everything between is the raw body.
		const bodyFrom = from + m[0].indexOf(">") + 1;
		const bodyTo = from + m[0].lastIndexOf("</");
		comments.push({
			from,
			to,
			lineStart: lineOf(from),
			lineEnd: lineOf(to - 1),
			id: attrs.id ?? null,
			parentId: attrs.parent_id ?? null,
			author: attrs.author ?? null,
			bodyFrom,
			bodyTo,
			body: m[2].trim(),
		});
	}

	return comments;
}

/** Whitespace only (any number of blank lines) — i.e. directly stacked blocks. */
const REGION_GAP_RE = /^\s*$/;

/**
 * Groups back-to-back comment blocks into regions. Two comments belong to the
 * same region when only whitespace separates them; any non-whitespace text
 * between them starts a new region. Input is assumed to be in document order.
 */
export function groupRegions(
	comments: ParsedComment[],
	text: string
): CommentRegion[] {
	const regions: CommentRegion[] = [];
	let current: ParsedComment[] = [];

	const flush = () => {
		if (!current.length) return;
		const first = current[0];
		const last = current[current.length - 1];
		regions.push({
			comments: current,
			wrapped: false,
			from: first.from,
			to: last.to,
			bodyFrom: first.from,
			bodyTo: last.to,
			lineStart: first.lineStart,
			lineEnd: last.lineEnd,
		});
		current = [];
	};

	for (const c of comments) {
		if (current.length === 0) {
			current = [c];
			continue;
		}
		const prev = current[current.length - 1];
		if (REGION_GAP_RE.test(text.slice(prev.to, c.from))) {
			current.push(c);
		} else {
			flush();
			current = [c];
		}
	}
	flush();
	return regions;
}

/**
 * Finds explicit discussion wrappers, including empty ones, then groups any
 * remaining comments using the original whitespace-separated convention.
 * A wrapper is accepted only when its contents are comments and whitespace;
 * this prevents the renderers from hiding unrelated note content.
 */
export function parseDiscussionRegions(text: string): CommentRegion[] {
	const comments = parseComments(text);
	const codeRanges = findCodeRanges(text);
	const lineOf = makeLineLookup(text);
	const wrapped: CommentRegion[] = [];
	const claimed = new Set<ParsedComment>();
	const ignored = new Set<ParsedComment>();
	const wrapperRe = /<discussion\s*>|<\/discussion\s*>/gi;
	let match: RegExpExecArray | null;
	let opening: { from: number; to: number; nested: boolean } | null = null;

	while ((match = wrapperRe.exec(text)) !== null) {
		const at = match.index;
		if (isInside(codeRanges, at) || comments.some((c) => at >= c.from && at < c.to)) continue;
		if (!match[0].startsWith("</")) {
			if (opening) opening.nested = true;
			else opening = { from: at, to: at + match[0].length, nested: false };
			continue;
		}
		if (!opening) continue;
		const from = opening.from;
		const to = at + match[0].length;
		const bodyFrom = opening.to;
		const bodyTo = at;
		const nested = opening.nested;
		opening = null;
		if (nested) continue;

		const inside = comments.filter((c) => c.from >= bodyFrom && c.to <= bodyTo);
		let cursor = bodyFrom;
		let valid = true;
		for (const c of inside) {
			if (!REGION_GAP_RE.test(text.slice(cursor, c.from))) {
				valid = false;
				break;
			}
			cursor = c.to;
		}
		if (!valid || !REGION_GAP_RE.test(text.slice(cursor, bodyTo))) {
			for (const c of inside) ignored.add(c);
			continue;
		}

		wrapped.push({
			comments: inside,
			wrapped: true,
			from,
			to,
			bodyFrom,
			bodyTo,
			lineStart: lineOf(from),
			lineEnd: lineOf(to - 1),
		});
		for (const c of inside) claimed.add(c);
	}

	return [
		...wrapped,
		...groupRegions(comments.filter((c) => !claimed.has(c) && !ignored.has(c)), text),
	].sort((a, b) => a.from - b.from);
}

/**
 * Collects `targetId` together with every comment transitively replying to it
 * (its descendants), so deleting a comment can cascade to its whole subtree.
 */
export function collectDescendantIds(
	comments: ParsedComment[],
	targetId: string
): Set<string> {
	const childrenOf = new Map<string, string[]>();
	for (const c of comments) {
		if (c.id && c.parentId) {
			const list = childrenOf.get(c.parentId) ?? [];
			list.push(c.id);
			childrenOf.set(c.parentId, list);
		}
	}

	const ids = new Set<string>();
	const stack = [targetId];
	while (stack.length) {
		const id = stack.pop()!;
		if (ids.has(id)) continue; // guards against a parent_id cycle
		ids.add(id);
		for (const child of childrenOf.get(id) ?? []) stack.push(child);
	}
	return ids;
}

/**
 * Orders two comments chronologically by their `id` (a `Date.now()` value), so
 * the oldest sorts first and the newest last. Comments with non-numeric or
 * missing ids fall back to document order, keeping them stable.
 */
function compareChronologically(a: CommentNode, b: CommentNode): number {
	const na = Number(a.comment.id);
	const nb = Number(b.comment.id);
	if (a.comment.id && b.comment.id && !Number.isNaN(na) && !Number.isNaN(nb)) {
		if (na !== nb) return na - nb;
	}
	return a.comment.from - b.comment.from;
}

/** Recursively sorts a node's replies oldest-first. */
function sortReplies(nodes: CommentNode[]): void {
	nodes.sort(compareChronologically);
	for (const node of nodes) sortReplies(node.children);
}

/**
 * Assembles a region's flat comment list into a forest keyed by `parent_id`.
 * Roots are comments with no `parent_id`, or whose parent is absent from the
 * region. A reply whose parent appears later, or points at itself, is treated
 * as a root so nothing is silently dropped. Each level is ordered
 * chronologically by `id`, so newer replies always appear below older ones
 * regardless of where their block physically sits in the note.
 */
export function buildForest(comments: ParsedComment[]): CommentNode[] {
	const byId = new Map<string, CommentNode>();
	for (const c of comments) {
		if (c.id) byId.set(c.id, { comment: c, children: [] });
	}

	const roots: CommentNode[] = [];
	const seenBefore = new Set<string>();
	for (const c of comments) {
		const node = c.id ? byId.get(c.id)! : { comment: c, children: [] };
		const parent =
			c.parentId && c.parentId !== c.id && seenBefore.has(c.parentId)
				? byId.get(c.parentId)
				: undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
		if (c.id) seenBefore.add(c.id);
	}

	sortReplies(roots);
	return roots;
}
