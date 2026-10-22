import { parseComments, parseDiscussionRegions } from "./parser.ts";
import { replyEdit } from "./comment-edit.ts";
import type { CommentFormat } from "./mention-client.ts";

export const discussionFormat: CommentFormat = {
	parse: (text) => parseComments(text),
	thread: (text, target) => parseDiscussionRegions(text).find((r) => r.comments.some((c) => c.from === target.from))?.comments ?? [],
	identify: (text, target, id) => text.slice(0, target.from) + text.slice(target.from).replace(/^<comment\b/, `<comment id="${id}"`),
	replied: (text, id) => text.includes(`data-aio-reply="${id}"`),
	reply: (text, request, author, body) => {
		const comments = parseComments(text);
		const target = comments.find((c) => c.id === request.commentId);
		if (!target) throw new Error("The comment no longer exists.");
		const id = Math.max(Date.now(), ...comments.map((c) => Number(c.id) || 0)) + 1;
		const edit = replyEdit(text, target, { id: String(id), author, parentId: target.id ?? undefined,
			body: body.replace(/<(\/?(?:comment|discussion)\b)/gi, "&lt;$1") });
		if (!edit) throw new Error("The discussion no longer exists.");
		const insert = edit.insert.replace(/<comment\b/, `<comment data-aio-reply="${request.id}"`);
		return text.slice(0, edit.from) + insert + text.slice(edit.to);
	},
};
