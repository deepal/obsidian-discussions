import { App, PluginSettingTab, Setting } from "obsidian";
import type CommentBlockPlugin from "./main.ts";

export interface CommentBlockSettings {
	/** Master toggle for rendering threads. When off, raw tags are left as-is. */
	enabled: boolean;
	/** Author name stamped on comments created via the command or Reply button. */
	username: string;
	/** Render comment bodies as Markdown (vs. plain text). */
	renderMarkdown: boolean;
}

export const DEFAULT_SETTINGS: CommentBlockSettings = {
	enabled: true,
	username: "",
	renderMarkdown: true,
};

export class CommentBlockSettingTab extends PluginSettingTab {
	private plugin: CommentBlockPlugin;

	constructor(app: App, plugin: CommentBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Enable comment threads")
			.setDesc("Render <comment> blocks as threaded discussions.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
					this.plugin.settings.enabled = v;
					await this.plugin.saveSettings();
					this.plugin.refreshAll();
				})
			);

		new Setting(containerEl)
			.setName("Your name")
			.setDesc("Stamped as the author on comments you create.")
			.addText((t) =>
				t
					.setPlaceholder("e.g. alice")
					.setValue(this.plugin.settings.username)
					.onChange(async (v) => {
						this.plugin.settings.username = v.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Render Markdown in comments")
			.setDesc("Format comment bodies as Markdown instead of plain text.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.renderMarkdown).onChange(async (v) => {
					this.plugin.settings.renderMarkdown = v;
					await this.plugin.saveSettings();
					this.plugin.refreshAll();
				})
			);
	}
}
