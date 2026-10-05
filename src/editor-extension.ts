import { editorInfoField } from "obsidian";
import { Component } from "obsidian";
import {
	EditorState,
	Extension,
	RangeSetBuilder,
	StateEffect,
	StateField,
} from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { parseDiscussionRegions, type CommentRegion } from "./parser.ts";
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

/** Dispatched on settings changes to force the thread field to rebuild. */
export const rebuildEffect = StateEffect.define<void>();

/** Stable signature of a region so an unchanged widget is not recreated. */
function regionSig(region: CommentRegion, settingsVersion: number): string {
	const parts = region.comments.map(
		(c) => `${c.id}|${c.parentId}|${c.author}|${c.body}`
	);
	return `${settingsVersion}::${region.wrapped}|${region.from}|${region.to}|${parts.join("§")}`;
}

/**
 * A block widget that replaces a region's `<comment>` source with its rendered
 * thread. Owns a `Component` for the lifetime of the DOM node so async
 * Markdown renders and their listeners are cleaned up on `destroy()`.
 */
class ThreadWidget extends WidgetType {
	private component: Component | null = null;

	constructor(
		private readonly plugin: CommentBlockPlugin,
		private readonly region: CommentRegion,
		private readonly sourcePath: string,
		private readonly sig: string
	) {
		super();
	}

	eq(other: ThreadWidget): boolean {
		return other.sig === this.sig && other.sourcePath === this.sourcePath;
	}

	toDOM(view: EditorView): HTMLElement {
		const el = createDiv();
		el.className = "cb-thread-widget";

		const component = new Component();
		component.load();
		this.component = component;

		renderThread(el, this.region, {
			app: this.plugin.app,
			component,
			settings: this.plugin.settings,
			sourcePath: this.sourcePath,
			onReply: (target, body) =>
				this.apply(view, (text) =>
					replyEdit(text, target, {
						id: this.plugin.newId(),
						author: this.plugin.authorName(),
						parentId: target.id ?? undefined,
						body,
					})
				),
			onEdit: (target, body) =>
				this.apply(view, (text) => editBodyEdit(text, target, body)),
			onDelete: (target) =>
				this.apply(view, (text) => deleteCommentEdit(text, target)),
			onDeleteDiscussion: () =>
				this.apply(view, (text) => deleteDiscussionEdit(text, this.region)),
			onAddComment: (body) =>
				this.apply(view, (text) =>
					addCommentEdit(text, this.region, {
						id: this.plugin.newId(),
						author: this.plugin.authorName(),
						body,
					})
				),
		});
		return el;
	}

	/** Computes an edit against the live document and dispatches it. */
	private apply(
		view: EditorView,
		compute: (text: string) => SourceEdit | null
	): void {
		const edit = compute(view.state.doc.toString());
		if (!edit) return;
		view.dispatch({
			changes: { from: edit.from, to: edit.to, insert: edit.insert },
		});
	}

	destroy(): void {
		this.component?.unload();
		this.component = null;
	}

	ignoreEvent(): boolean {
		// Let the widget's own controls (reply textarea, buttons, links) handle
		// events instead of the editor treating them as edits/selection changes.
		return true;
	}
}

function buildDecorations(
	state: EditorState,
	plugin: CommentBlockPlugin
): DecorationSet {
	if (!plugin.settings.enabled) return Decoration.none;

	const text = state.doc.toString();
	const regions = parseDiscussionRegions(text);
	if (regions.length === 0) return Decoration.none;

	const sel = state.selection.main;
	// `false` returns undefined instead of throwing if Obsidian hasn't attached
	// the field yet (e.g. during initial editor construction).
	const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
	const builder = new RangeSetBuilder<Decoration>();

	for (const region of regions) {
		const startLine = state.doc.lineAt(region.from);
		const endLine = state.doc.lineAt(region.to);

		// Keep raw source visible while the caret/selection is inside the region
		// so it can be edited directly.
		const overlaps = sel.from <= endLine.to && sel.to >= startLine.from;
		if (overlaps) continue;

		const widget = new ThreadWidget(
			plugin,
			region,
			sourcePath,
			regionSig(region, plugin.settingsVersion)
		);
		builder.add(
			startLine.from,
			endLine.to,
			Decoration.replace({ widget, block: true })
		);
	}

	return builder.finish();
}

/** Builds the Live Preview / Source editor extension. */
export function createEditorExtension(plugin: CommentBlockPlugin): Extension {
	return StateField.define<DecorationSet>({
		create(state) {
			return buildDecorations(state, plugin);
		},
		update(deco, tr) {
			const forced = tr.effects.some((e) => e.is(rebuildEffect));
			if (tr.docChanged || tr.selection || forced) {
				return buildDecorations(tr.state, plugin);
			}
			return deco.map(tr.changes);
		},
		provide: (f) => EditorView.decorations.from(f),
	});
}
