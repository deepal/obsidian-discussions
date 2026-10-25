import { MentionClient } from "./mention-client.ts";
import { discussionFormat } from "./mention-format.ts";
import { mentionExtension } from "./mention-extension.ts";
import { Editor, MarkdownView, Plugin } from "obsidian";
import { createEditorExtension, rebuildEffect } from "./editor-extension.ts";
import { ReadingViewManager } from "./reading-view.ts";
import { newDiscussionBlock } from "./comment-edit.ts";
import {
	CommentBlockSettings,
	CommentBlockSettingTab,
	DEFAULT_SETTINGS,
	normalizeSettings,
} from "./settings.ts";

export default class CommentBlockPlugin extends Plugin {
	settings: CommentBlockSettings = DEFAULT_SETTINGS;

	/** Bumped on every settings change so editor widgets rebuild. */
	settingsVersion = 0;

	mentions!: MentionClient;

	private readingManager!: ReadingViewManager;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.mentions = this.addChild(new MentionClient(this, "comment-block", discussionFormat, () => this.settings.enabled));
		this.mentions.load();
		this.registerEditorExtension(mentionExtension(this.mentions, discussionFormat));
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
	 * Inserts an empty discussion and leaves the caret on a blank line below it
	 * so the panel renders immediately. Blank lines isolate the HTML block from
	 * surrounding prose without replacing any existing text.
	 */
	private startThread(editor: Editor): void {
		const cursor = editor.getCursor();
		const atLineStart = cursor.ch === 0;
		const needsLeadingBlank = cursor.line > 0 && editor.getLine(cursor.line - 1).trim() !== "";
		const lead = atLineStart ? (needsLeadingBlank ? "\n" : "") : "\n\n";
		const atLineEnd = cursor.ch === editor.getLine(cursor.line).length;
		const trail = atLineEnd && cursor.line < editor.lastLine() ? "\n" : "\n\n";
		const openLine = cursor.line + (atLineStart ? (needsLeadingBlank ? 1 : 0) : 2);

		// Insert and move the caret together so no intermediate selection exposes
		// the source, and the whole insertion remains a single undoable edit.
		editor.transaction({
			changes: [{ from: cursor, text: `${lead}${newDiscussionBlock()}${trail}` }],
			selection: { from: { line: openLine + 1, ch: 0 } },
		});
		editor.focus();
	}

	/** Forces every renderer to redraw (e.g. after a settings change). */
	refreshAll(): void {
		this.mentions?.settingsChanged();
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
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

/** Minimal shape of the CodeMirror view exposed on Obsidian's Editor. */
interface EditorViewLike {
	dispatch(spec: { effects?: unknown }): void;
}
