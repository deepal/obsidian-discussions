import { App, PluginSettingTab, type Events, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { BRIDGE_CHANGED, BRIDGE_DISCOVER, LEGACY_BRIDGE_CHANGED, LEGACY_BRIDGE_DISCOVER, isAgentBridge } from "./agent-bridge.ts";
import type CommentBlockPlugin from "./main.ts";
export { DEFAULT_SETTINGS, normalizeSettings, type CommentBlockSettings } from "./settings-data.ts";

export class CommentBlockSettingTab extends PluginSettingTab {
	private plugin: CommentBlockPlugin;

	constructor(app: App, plugin: CommentBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		for (const event of [BRIDGE_CHANGED, LEGACY_BRIDGE_CHANGED]) {
			plugin.registerEvent((app.workspace as Events).on(event, () => {
				if (this.containerEl?.isConnected) this.refreshDomState();
			}));
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const general: SettingDefinition[] = [
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
		return [
			{
				type: "group",
				heading: "AI Agents",
				visible: () => {
					const visible = !this.hasConfiguredAgent();
					this.containerEl?.classList.toggle("cb-settings-agent-ready", !visible);
					return visible;
				},
				items: [{
					name: "Agent mentions",
					desc: this.agentDescription().textContent ?? "",
					aliases: ["AI Overview", "agent name tag", "agent mentions"],
					render: (setting) => {
						setting.setName("");
						setting.setDesc(this.agentDescription());
					},
				}],
			},
			{ type: "group", heading: "General", cls: "cb-settings-general", items: general },
		];
	}

	private hasConfiguredAgent(): boolean {
		let ready = false;
		for (const [event, version] of [[BRIDGE_DISCOVER, 2], [LEGACY_BRIDGE_DISCOVER, 1]] as const) {
			if (ready) break;
			(this.app.workspace as Events).trigger(event, (candidate: unknown) => {
				if (isAgentBridge(candidate, version) && candidate.tag.trim()) ready = true;
			});
		}
		return ready;
	}

	private agentDescription(): DocumentFragment {
		const description = createFragment();
		description.append("Bring your AI agent into discussion threads with ");
		description.createEl("a", {
			text: "AI Overview",
			href: "https://community.obsidian.md/plugins/ai-overview",
			attr: { target: "_blank", rel: "noopener noreferrer" },
		});
		description.append(". Install and enable the plugin on desktop, configure your agent under ");
		description.createEl("strong", { text: "Settings → AI Overview" });
		description.append(", and set an ");
		description.createEl("strong", { text: "Agent name tag" });
		description.append(" (e.g. ");
		description.createEl("code", { text: "Atlas" });
		description.append("). Then mention ");
		description.createEl("code", { text: "@Atlas" });
		description.append(" in a discussion comment or reply to request any task the agent can complete with its existing tools and permissions, without additional approval. The agent carries out the work and posts its response in the same thread.");
		return description;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== "username" || typeof value !== "string") return;
		this.plugin.settings.username = value.trim();
		await this.plugin.saveSettings();
	}
}
