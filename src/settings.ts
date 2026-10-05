import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type CommentBlockPlugin from "./main.ts";
export { DEFAULT_SETTINGS, normalizeSettings, type CommentBlockSettings } from "./settings-data.ts";

export class CommentBlockSettingTab extends PluginSettingTab {
	private plugin: CommentBlockPlugin;

	constructor(app: App, plugin: CommentBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Enable comment threads",
				desc: "Render comment blocks as threaded discussions.",
				render: (setting) => {
					setting.addToggle((t) => t.setValue(this.plugin.settings.enabled).onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAll();
					}));
				},
			},
			{
				name: "Your name",
				desc: "Stamped as the author on comments you create.",
				control: { type: "text", key: "username", placeholder: "Alice" },
			},
			{
				name: "Render Markdown in comments",
				desc: "Format comment bodies as Markdown instead of plain text.",
				render: (setting) => {
					setting.addToggle((t) => t.setValue(this.plugin.settings.renderMarkdown).onChange(async (value) => {
						this.plugin.settings.renderMarkdown = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAll();
					}));
				},
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== "username" || typeof value !== "string") return;
		this.plugin.settings.username = value.trim();
		await this.plugin.saveSettings();
	}
}
