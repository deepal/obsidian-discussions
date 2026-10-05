import { Editor, MarkdownView, Plugin } from "obsidian";
import { createEditorExtension, rebuildEffect } from "./editor-extension.ts";
import { ReadingViewManager } from "./reading-view.ts";
import { newDiscussionBlock } from "./comment-edit.ts";
import {
	CommentBlockSettings,
	CommentBlockSettingTab,
	DEFAULT_SETTINGS,
} from "./settings.ts";

export default class CommentBlockPlugin extends Plugin {
	settings: CommentBlockSettings = DEFAULT_SETTINGS;

	/** Bumped on every settings change so editor widgets rebuild. */
	settingsVersion = 0;

	private readingManager!: ReadingViewManager;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.readingManager = new ReadingViewManager(this);

		this.registerEditorExtension(createEditorExtension(this));
		this.registerMarkdownPostProcessor(this.readingManager.handleBlock);

		this.addSettingTab(new CommentBlockSettingTab(this.app, this));
		this.updateBodyClass();

		this.addCommand({
			id: "start-discussion",
			name: "Start discussion",
			editorCallback: (editor) => this.startThread(editor),
		});
	}

	onunload(): void {
		this.readingManager?.destroy();
		document.body.classList.remove("cb-active");
	}

	/** Last id handed out, so rapid replies within one millisecond stay unique. */
	private lastId = 0;

	/**
	 * A fresh comment id doubling as a creation timestamp. Strictly increasing:
	 * if two comments are created in the same millisecond the second is bumped by
	 * one, keeping ids unique and their chronological order intact.
	 */
	newId(): string {
		const now = Date.now();
		this.lastId = now > this.lastId ? now : this.lastId + 1;
		return this.lastId.toString();
	}

	/** Author name to stamp on created comments; falls back when unset. */
	authorName(): string {
		return this.settings.username.trim() || "anonymous";
	}

	/**
	 * Inserts a discussion with its first empty comment and places the caret in
	 * that comment's body. The block is padded with blank lines so Obsidian
	 * treats it as a raw-HTML block rather than inline markup.
	 */
	private startThread(editor: Editor): void {
		const block = newDiscussionBlock({ id: this.newId(), author: this.authorName() });
		const cursor = editor.getCursor();
		const atLineStart = cursor.ch === 0;
		const lead = atLineStart ? "" : "\n\n";
		const insert = `${lead}${block}\n`;

		editor.replaceRange(insert, cursor);
		// Caret onto the blank body line (the line between the open/close tags).
		const openLine = cursor.line + (atLineStart ? 0 : 2);
		editor.setCursor({ line: openLine + 2, ch: 0 });
		editor.focus();
	}

	/** Forces every renderer to redraw (e.g. after a settings change). */
	refreshAll(): void {
		this.settingsVersion++;
		this.updateBodyClass();
		this.readingManager?.refresh();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView)) return;
			const cm = (leaf.view.editor as { cm?: EditorViewLike }).cm;
			cm?.dispatch({ effects: rebuildEffect.of() });
		});
	}

	/** Reflects the enabled setting on <body> so CSS can react to it. */
	private updateBodyClass(): void {
		document.body.classList.toggle("cb-active", this.settings.enabled);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** Minimal shape of the CodeMirror view exposed on Obsidian's Editor. */
interface EditorViewLike {
	dispatch(spec: { effects?: unknown }): void;
}
