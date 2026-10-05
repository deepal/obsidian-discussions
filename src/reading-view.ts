import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	TFile,
} from "obsidian";
import { parseDiscussionRegions } from "./parser.ts";
import {
	addCommentEdit,
	deleteCommentEdit,
	deleteDiscussionEdit,
	editBodyEdit,
	replyEdit,
	type SourceEdit,
} from "./comment-edit.ts";
import { renderThread } from "./thread.ts";
import type CommentBlockPlugin from "./main.ts";

/**
 * Renders comment threads in Reading view via a Markdown post-processor. The
 * post-processor runs per rendered block; each call recovers the raw note text
 * and the block's line range from `getSectionInfo`, so threads are built from
 * source rather than from the (sanitiser-stripped) rendered HTML.
 */
export class ReadingViewManager {
	private plugin: CommentBlockPlugin;

	constructor(plugin: CommentBlockPlugin) {
		this.plugin = plugin;
	}

	/** Markdown post-processor entry point — registered in main.ts. */
	handleBlock = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		if (!this.plugin.settings.enabled) return;

		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const regions = parseDiscussionRegions(info.text);
		if (regions.length === 0) return;

		// A region may span several rendered blocks. Render each region once, in
		// the block that holds its opening tag; blank any block that merely
		// continues an already-owned region so raw tags never leak through.
		const owned = regions.filter(
			(r) => r.lineStart >= info.lineStart && r.lineStart <= info.lineEnd
		);
		const continues = regions.some(
			(r) =>
				r.lineStart < info.lineStart &&
				r.lineEnd >= info.lineStart &&
				owned.indexOf(r) === -1
		);

		if (owned.length === 0) {
			if (continues) el.empty(); // continuation block: hide raw tags
			return;
		}

		el.empty();
		const child = new MarkdownRenderChild(el);
		ctx.addChild(child);

		for (const region of owned) {
			const panel = el.createDiv();
			renderThread(panel, region, {
				app: this.plugin.app,
				component: child,
				settings: this.plugin.settings,
				sourcePath: ctx.sourcePath,
				onReply: (target, body) =>
					void this.applyEdit(ctx.sourcePath, (text) =>
						replyEdit(text, target, {
							id: this.plugin.newId(),
							author: this.plugin.authorName(),
							parentId: target.id ?? undefined,
							body,
						})
					),
				onEdit: (target, body) =>
					void this.applyEdit(ctx.sourcePath, (text) =>
						editBodyEdit(text, target, body)
					),
				onDelete: (target) =>
					void this.applyEdit(ctx.sourcePath, (text) =>
						deleteCommentEdit(text, target)
					),
				onDeleteDiscussion: () =>
					void this.applyEdit(ctx.sourcePath, (text) =>
						deleteDiscussionEdit(text, region)
					),
				onAddComment: (body) =>
					void this.applyEdit(ctx.sourcePath, (text) =>
						addCommentEdit(text, region, {
							id: this.plugin.newId(),
							author: this.plugin.authorName(),
							body,
						})
					),
			});
		}
	};

	/**
	 * Applies a computed source edit to the note. The edit is recomputed against
	 * the file's current text inside `process`, so offsets stay correct even if
	 * the note changed since the panel was rendered.
	 */
	private async applyEdit(
		sourcePath: string,
		compute: (text: string) => SourceEdit | null
	): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return;

		await this.plugin.app.vault.process(file, (data) => {
			const edit = compute(data);
			if (!edit) return data;
			return data.slice(0, edit.from) + edit.insert + data.slice(edit.to);
		});
	}

	/** Re-renders open reading views (e.g. after a settings change). */
	refresh(): void {
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				view.previewMode?.rerender(true);
			}
		});
	}

	destroy(): void {
		// MarkdownRenderChild instances are torn down by Obsidian with their els.
	}
}
