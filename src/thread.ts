import { App, Component, Menu, setIcon } from "obsidian";
import {
	buildForest,
	type CommentNode,
	type CommentRegion,
	type ParsedComment,
} from "./parser.ts";
import { renderCommentBody } from "./render.ts";
import type { CommentBlockSettings } from "./settings.ts";

export interface ThreadContext {
	app: App;
	/** Lifecycle owner for async Markdown renders. */
	component: Component;
	settings: CommentBlockSettings;
	sourcePath: string;
	/** Persists a reply to `target`; the layer decides where in the source it lands. */
	onReply: (target: ParsedComment, body: string) => void;
	/** Replaces `target`'s body in the source. */
	onEdit: (target: ParsedComment, body: string) => void;
	/** Deletes `target` and its whole reply subtree from the source. */
	onDelete: (target: ParsedComment) => void;
	/** Deletes this entire panel and every comment in it. */
	onDeleteDiscussion: () => void;
	/** Appends a new top-level comment (no parent) to the end of this thread. */
	onAddComment: (body: string) => void;
}

/** Stable avatar hue from an author name so each person keeps one colour. */
function hueFor(name: string): number {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash << 5) - hash + name.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash) % 360;
}

/** Up-to-two-letter initials for the avatar. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a `Date.now()`-style id as a short relative label ("2d ago").
 * Returns null when the id isn't a millisecond timestamp so hand-written ids
 * don't produce a nonsensical time.
 */
function relativeTime(id: string | null): { label: string; title: string } | null {
	if (!id || !/^\d{10,}$/.test(id)) return null;
	const then = Number(id);
	const diff = Date.now() - then;
	const abs = new Date(then).toLocaleString();

	let label: string;
	if (diff < MINUTE) label = "just now";
	else if (diff < HOUR) label = `${Math.floor(diff / MINUTE)}m ago`;
	else if (diff < DAY) label = `${Math.floor(diff / HOUR)}h ago`;
	else if (diff < 30 * DAY) label = `${Math.floor(diff / DAY)}d ago`;
	else label = new Date(then).toLocaleDateString();

	return { label, title: abs };
}

/** Renders a Jira-style thread panel for one region into `container`. */
export function renderThread(
	container: HTMLElement,
	region: CommentRegion,
	ctx: ThreadContext
): void {
	container.addClass("cb-thread");

	const header = container.createDiv({ cls: "cb-thread__header" });
	setIcon(header.createSpan({ cls: "cb-thread__icon" }), "message-square");
	const count = region.comments.length;
	header.createSpan({
		cls: "cb-thread__title",
		text: `${count} ${count === 1 ? "comment" : "comments"}`,
	});
	const more = header.createEl("button", {
		cls: "cb-thread__menu",
		attr: { "aria-label": "Discussion actions" },
	});
	setIcon(more, "ellipsis");
	more.addEventListener("click", (evt) => {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle("Delete discussion").setIcon("trash").onClick(() =>
				confirmDeleteDiscussion(header, more, count, ctx)
			)
		);
		menu.showAtMouseEvent(evt);
	});

	const list = container.createDiv({ cls: "cb-thread__list" });
	for (const node of buildForest(region.comments)) {
		renderNode(list, node, ctx);
	}

	const footer = container.createDiv({ cls: "cb-thread__footer" });
	const add = action(footer, "Add comment", () => {
		if (container.querySelector(".cb-add-form")) return; // already open
		openComposeForm(footer, add, ctx);
	});
}

/** Confirms deletion of the whole panel before removing its source. */
function confirmDeleteDiscussion(
	header: HTMLElement,
	more: HTMLButtonElement,
	count: number,
	ctx: ThreadContext
): void {
	if (header.querySelector(".cb-thread__confirm")) return;
	more.hide();
	const confirm = header.createDiv({ cls: "cb-thread__confirm" });
	confirm.createSpan({
		cls: "cb-confirm__label",
		text: count === 0
			? "Delete this discussion?"
			: `Delete this discussion and its ${count} ${count === 1 ? "comment" : "comments"}?`,
	});
	action(confirm, "Delete", ctx.onDeleteDiscussion).addClass("cb-action--danger");
	action(confirm, "Cancel", () => {
		confirm.remove();
		more.show();
	});
}

function renderNode(parent: HTMLElement, node: CommentNode, ctx: ThreadContext): void {
	const { comment } = node;
	const author = comment.author ?? "Unknown";

	const wrap = parent.createDiv({ cls: "cb-comment" });

	const avatar = wrap.createDiv({ cls: "cb-comment__avatar" });
	avatar.setText(initials(author));
	avatar.style.setProperty("--cb-hue", String(hueFor(author)));

	const main = wrap.createDiv({ cls: "cb-comment__main" });

	const meta = main.createDiv({ cls: "cb-comment__meta" });
	meta.createSpan({ cls: "cb-comment__author", text: author });
	const rel = relativeTime(comment.id);
	if (rel) {
		meta.createSpan({ cls: "cb-comment__time", text: rel.label }).title = rel.title;
	}

	const body = main.createDiv({ cls: "cb-comment__body" });
	renderBody(body, comment, ctx);

	const actions = main.createDiv({ cls: "cb-comment__actions" });

	// Replies nest under their target so arbitrarily deep threads stay readable.
	const children = main.createDiv({ cls: "cb-comment__children" });
	for (const child of node.children) {
		renderNode(children, child, ctx);
	}

	const reply = action(actions, "Reply", () => {
		if (main.querySelector(".cb-reply-form")) return; // already open
		openReplyForm(main, children, reply, comment, ctx);
	});
	const edit = action(actions, "Edit", () => {
		if (main.querySelector(".cb-edit-form")) return;
		openEditForm(body, actions, comment, ctx);
	});
	action(actions, "Delete", () => {
		confirmDelete(actions, edit, reply, node, ctx);
	});
}

/** Renders a comment body honouring the Markdown setting. */
function renderBody(el: HTMLElement, comment: ParsedComment, ctx: ThreadContext): void {
	el.empty();
	renderCommentBody(
		ctx.app,
		ctx.component,
		el,
		comment.body,
		ctx.sourcePath,
		ctx.settings.renderMarkdown
	);
}

/** Creates a muted link-style action trigger (no button chrome). */
function action(
	row: HTMLElement,
	label: string,
	onClick: () => void
): HTMLAnchorElement {
	const a = row.createEl("a", { cls: "cb-action", text: label });
	a.addEventListener("click", (evt) => {
		evt.preventDefault();
		onClick();
	});
	return a;
}

/** Opens an inline reply editor beneath a comment's body. */
function openReplyForm(
	main: HTMLElement,
	children: HTMLElement,
	replyLink: HTMLAnchorElement,
	target: ParsedComment,
	ctx: ThreadContext
): void {
	replyLink.addClass("is-disabled");

	const { form, input } = buildForm("cb-reply-form", "Write a reply…", "Reply");
	const close = () => {
		form.remove();
		replyLink.removeClass("is-disabled");
	};
	wireForm(form, input, close, (text) => ctx.onReply(target, text));

	// Place the form above the child replies so it stays attached to its parent.
	main.insertBefore(form, children);
	input.focus();
}

/** Opens an inline editor for a new top-level comment in the panel footer. */
function openComposeForm(
	footer: HTMLElement,
	addLink: HTMLAnchorElement,
	ctx: ThreadContext
): void {
	addLink.addClass("is-disabled");

	const { form, input } = buildForm("cb-add-form", "Write a comment…", "Comment");
	const close = () => {
		form.remove();
		addLink.removeClass("is-disabled");
	};
	wireForm(form, input, close, (text) => ctx.onAddComment(text));

	footer.insertBefore(form, addLink);
	input.focus();
}

/** Swaps a comment body for an inline editor pre-filled with its raw text. */
function openEditForm(
	body: HTMLElement,
	actions: HTMLElement,
	target: ParsedComment,
	ctx: ThreadContext
): void {
	body.hide();
	actions.hide();

	const { form, input } = buildForm("cb-edit-form", "Edit comment…", "Save");
	input.value = target.body;
	const close = () => {
		form.remove();
		body.show();
		actions.show();
	};
	wireForm(form, input, close, (text) => ctx.onEdit(target, text));

	body.insertAdjacentElement("afterend", form);
	input.focus();
}

/** Replaces the actions row with an inline "Delete N comment(s)?" confirmation. */
function confirmDelete(
	actions: HTMLElement,
	editLink: HTMLAnchorElement,
	replyLink: HTMLAnchorElement,
	node: CommentNode,
	ctx: ThreadContext
): void {
	if (actions.querySelector(".cb-confirm")) return;
	editLink.addClass("is-disabled");
	replyLink.addClass("is-disabled");

	const descendants = countNodes(node) - 1;
	const confirm = actions.createDiv({ cls: "cb-confirm" });
	confirm.createSpan({
		cls: "cb-confirm__label",
		text: descendants
			? `Delete this comment and ${descendants} ${descendants === 1 ? "reply" : "replies"}?`
			: "Delete this comment?",
	});
	action(confirm, "Delete", () => ctx.onDelete(node.comment)).addClass(
		"cb-action--danger"
	);
	action(confirm, "Cancel", () => {
		confirm.remove();
		editLink.removeClass("is-disabled");
		replyLink.removeClass("is-disabled");
	});
}

/** Total comments in a subtree (the node plus all descendants). */
function countNodes(node: CommentNode): number {
	return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

/** Builds a reusable textarea form with Save/Cancel controls. */
function buildForm(
	cls: string,
	placeholder: string,
	saveLabel: string
): { form: HTMLElement; input: HTMLTextAreaElement } {
	const form = createDiv({ cls });
	const input = form.createEl("textarea", { cls: "cb-form__input" });
	input.placeholder = placeholder;
	const controls = form.createDiv({ cls: "cb-form__controls" });
	controls.createEl("button", { cls: "cb-form__save mod-cta", text: saveLabel });
	controls.createEl("button", { cls: "cb-form__cancel", text: "Cancel" });
	return { form, input };
}

/** Wires submit/cancel behaviour (buttons + Cmd/Ctrl+Enter / Escape). */
function wireForm(
	form: HTMLElement,
	input: HTMLTextAreaElement,
	close: () => void,
	submitText: (text: string) => void
): void {
	const submit = () => {
		const text = input.value.trim();
		if (!text) {
			close();
			return;
		}
		submitText(text);
		// Close explicitly rather than relying on the source edit to re-render the
		// panel: an unchanged edit (e.g. Save without touching the text) produces
		// identical source, so no re-render fires and the form would otherwise stay
		// stuck open. Harmless when a re-render does replace the panel.
		close();
	};

	form.querySelector<HTMLButtonElement>(".cb-form__save")!.addEventListener(
		"click",
		submit
	);
	form.querySelector<HTMLButtonElement>(".cb-form__cancel")!.addEventListener(
		"click",
		close
	);
	input.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
			evt.preventDefault();
			submit();
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			close();
		}
	});
}
