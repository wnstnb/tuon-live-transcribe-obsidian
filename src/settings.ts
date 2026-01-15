import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export interface MyPluginSettings {
	/** AssemblyAI API key (stored in Obsidian plugin settings). */
	assemblyAiApiKey: string;
	/** OpenRouter API key (stored in Obsidian plugin settings). */
	openRouterApiKey: string;
	/** OpenRouter model id, e.g. "openai/gpt-5-mini". */
	openRouterModel: string;
	/** Optional: sent as HTTP-Referer header to OpenRouter for attribution. */
	openRouterReferer: string;
	/** Optional: sent as X-Title header to OpenRouter for attribution. */
	openRouterAppTitle: string;
	/** Show the live widget overlay in the editor. */
	showWidget: boolean;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	assemblyAiApiKey: "",
	openRouterApiKey: "",
	openRouterModel: "openai/gpt-5-mini",
	openRouterReferer: "",
	openRouterAppTitle: "Tuon Live Transcribe (Obsidian)",
	showWidget: true,
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("AssemblyAI API key")
			.setDesc("Used for live transcription. Stored locally in your Obsidian settings.")
			.addText((text) =>
				text
					.setPlaceholder("aai-...")
					.setValue(this.plugin.settings.assemblyAiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.assemblyAiApiKey = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.onClick(() => {
						void this.plugin.testAssemblyAiKey();
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter API key")
			.setDesc("Used for summarization and transcript cleanup. Stored locally in your Obsidian settings.")
			.addText((text) =>
				text
					.setPlaceholder("sk-or-...")
					.setValue(this.plugin.settings.openRouterApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openRouterApiKey = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.onClick(() => {
						void this.plugin.testOpenRouterKey();
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter model")
			.setDesc('Example: "openai/gpt-5-mini", "anthropic/claude-3.5-sonnet", "x-ai/grok-4-fast".')
			.addText((text) =>
				text
					.setPlaceholder("openai/gpt-5-mini")
					.setValue(this.plugin.settings.openRouterModel)
					.onChange(async (value) => {
						this.plugin.settings.openRouterModel = value.trim() || DEFAULT_SETTINGS.openRouterModel;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter referer (optional)")
			.setDesc("If set, sent as HTTP-Referer header. Some OpenRouter features use this for attribution.")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com")
					.setValue(this.plugin.settings.openRouterReferer)
					.onChange(async (value) => {
						this.plugin.settings.openRouterReferer = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OpenRouter app title (optional)")
			.setDesc("If set, sent as X-Title header for attribution.")
			.addText((text) =>
				text
					.setPlaceholder("My Obsidian Plugin")
					.setValue(this.plugin.settings.openRouterAppTitle)
					.onChange(async (value) => {
						this.plugin.settings.openRouterAppTitle = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show live widget in editor")
			.setDesc("Toggle the live transcription widget overlay in the editor.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showWidget)
					.onChange(async (value) => {
						this.plugin.settings.showWidget = value;
						await this.plugin.saveSettings();
						this.plugin.setWidgetVisible(value);
					})
			);
	}
}
