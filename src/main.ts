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

	async onload() {
		await this.loadSettings();

		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.setText("");

		this.liveTranscribe = new LiveTranscribeService({
			app: this.app,
			getAssemblyAiApiKey: () => this.settings.assemblyAiApiKey,
			onStatusText: (t) => this.statusBarItemEl?.setText(t),
		});

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
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
