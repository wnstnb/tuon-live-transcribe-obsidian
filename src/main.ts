import { App, Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { openRouterChatCompletion } from "./ai/openrouter";
import { buildSystemPrompt, buildUserPrompt, NotesAction } from "./ai/voiceSummaryPrompts";
import { LiveTranscribeService } from "./transcribe/liveTranscribeService";
import {
	showTestResultToast,
	testAssemblyAiApiKey,
	testOpenRouterApiKey,
} from "./diagnostics/apiKeyDiagnostics";

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private liveTranscribe: LiveTranscribeService | null = null;
	private statusBarItemEl: HTMLElement | null = null;
	private widgetEl: HTMLDivElement | null = null;
	private widgetStatusEl: HTMLSpanElement | null = null;
	private widgetButtonEl: HTMLButtonElement | null = null;

	async onload() {
		await this.loadSettings();

		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.setText("");

		this.liveTranscribe = new LiveTranscribeService({
			app: this.app,
			getAssemblyAiApiKey: () => this.settings.assemblyAiApiKey,
			onStatusText: (t) => this.updateStatusText(t),
			onRunningChange: (running) => this.updateWidgetState(running),
		});

		this.initLiveWidget();

		this.addCommand({
			id: "tuon-live-transcription-toggle",
			name: "Tuon: Toggle live transcription",
			callback: () => this.liveTranscribe?.toggle(),
		});

		this.addCommand({
			id: "tuon-live-transcription-start",
			name: "Tuon: Start live transcription",
			callback: () => void this.liveTranscribe?.start(),
		});

		this.addCommand({
			id: "tuon-live-transcription-stop",
			name: "Tuon: Stop live transcription",
			callback: () => this.liveTranscribe?.stop(),
		});

		this.addCommand({
			id: "tuon-summarize-selection",
			name: "Tuon: Summarize selection (OpenRouter)",
			editorCallback: async (editor: Editor) => {
				await this.runNotesAction(editor, "summary");
			},
		});

		this.addCommand({
			id: "tuon-prettify-selection",
			name: "Tuon: Prettify selection (OpenRouter)",
			editorCallback: async (editor: Editor) => {
				await this.runNotesAction(editor, "prettify");
			},
		});

		this.addCommand({
			id: "tuon-test-assemblyai-key",
			name: "Tuon: Test AssemblyAI API key",
			callback: () => void this.testAssemblyAiKey(),
		});

		this.addCommand({
			id: "tuon-test-openrouter-key",
			name: "Tuon: Test OpenRouter API key",
			callback: () => void this.testOpenRouterKey(),
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		try {
			this.liveTranscribe?.stop();
		} catch {}
		this.statusBarItemEl?.setText("");
		this.destroyLiveWidget();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private updateStatusText(text: string) {
		this.statusBarItemEl?.setText(text);
		if (this.widgetStatusEl) {
			this.widgetStatusEl.textContent = text || "Idle";
		}
	}

	private updateWidgetState(running: boolean) {
		if (this.widgetButtonEl) {
			this.widgetButtonEl.textContent = running ? "Stop" : "Start";
		}
		if (this.widgetEl) {
			this.widgetEl.dataset.running = running ? "true" : "false";
		}
	}

	private initLiveWidget() {
		if (this.widgetEl) return;
		const container = document.createElement("div");
		container.className = "tuon-live-transcribe-widget";
		container.setAttr("aria-live", "polite");
		container.dataset.running = "false";

		const status = document.createElement("span");
		status.textContent = "Idle";
		status.style.fontSize = "12px";
		status.style.marginRight = "8px";
		status.style.opacity = "0.9";

		const button = document.createElement("button");
		button.type = "button";
		button.textContent = "Start";
		button.style.fontSize = "12px";
		button.style.padding = "4px 8px";
		button.style.borderRadius = "6px";
		button.style.border = "1px solid var(--background-modifier-border)";
		button.style.background = "var(--background-secondary)";
		button.style.color = "var(--text-normal)";
		button.style.cursor = "pointer";

		this.registerDomEvent(button, "click", () => {
			this.liveTranscribe?.toggle();
		});

		container.appendChild(status);
		container.appendChild(button);

		// Minimal inline styling to float in editor view.
		container.style.position = "fixed";
		container.style.right = "16px";
		container.style.bottom = "16px";
		container.style.zIndex = "1000";
		container.style.display = "flex";
		container.style.alignItems = "center";
		container.style.gap = "8px";
		container.style.padding = "8px 10px";
		container.style.borderRadius = "10px";
		container.style.background = "var(--background-primary)";
		container.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";

		document.body.appendChild(container);

		this.widgetEl = container;
		this.widgetStatusEl = status;
		this.widgetButtonEl = button;
	}

	private destroyLiveWidget() {
		if (this.widgetEl) {
			this.widgetEl.remove();
		}
		this.widgetEl = null;
		this.widgetStatusEl = null;
		this.widgetButtonEl = null;
	}

	async testAssemblyAiKey() {
		const res = await testAssemblyAiApiKey(this.settings.assemblyAiApiKey);
		showTestResultToast(res);
	}

	async testOpenRouterKey() {
		const res = await testOpenRouterApiKey({
			apiKey: this.settings.openRouterApiKey,
			model: this.settings.openRouterModel,
			referer: this.settings.openRouterReferer,
			appTitle: this.settings.openRouterAppTitle,
		});
		showTestResultToast(res);
	}

	private async runNotesAction(editor: Editor, action: NotesAction) {
		const selection = editor.getSelection()?.trim() ?? "";
		if (!selection) {
			new Notice("Select some text first.");
			return;
		}
		if (!this.settings.openRouterApiKey?.trim()) {
			new Notice("Missing OpenRouter API key. Set it in plugin settings.");
			return;
		}

		const system = buildSystemPrompt(action);
		const prompt = buildUserPrompt({
			action,
			transcription: selection,
			// Keep timestamp out for now (optional) to avoid timezone surprises.
		});

		try {
			new Notice(action === "summary" ? "Summarizing…" : "Prettifying…");
			const out = await openRouterChatCompletion(
				{
					apiKey: this.settings.openRouterApiKey,
					model: this.settings.openRouterModel,
					referer: this.settings.openRouterReferer,
					appTitle: this.settings.openRouterAppTitle,
				},
				{
					messages: [
						{ role: "system", content: system },
						{ role: "user", content: prompt },
					],
					temperature: action === "summary" ? 0.4 : 0.2,
				}
			);

			if (action === "prettify") {
				editor.replaceSelection(out);
			} else {
				editor.replaceSelection(`${selection}\n\n---\n\n## Summary\n\n${out}\n`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`AI request failed: ${msg}`);
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
