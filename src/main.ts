import { App, Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import { openRouterChatCompletion } from "./ai/openrouter";
import { buildSystemPrompt, buildUserPrompt, NotesAction } from "./ai/voiceSummaryPrompts";
import { LiveTranscribeService } from "./transcribe/liveTranscribeService";
import { AudioVisualizer } from "./ui/audioVisualizer";
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
	private widgetButtonEl: HTMLButtonElement | null = null;
	private widgetTranscriptEl: HTMLDivElement | null = null;
	private widgetVisualizerCanvasEl: HTMLCanvasElement | null = null;
	private widgetTimerEl: HTMLSpanElement | null = null;
	private widgetTimerIntervalId: number | null = null;
	private widgetTimerStart: number | null = null;
	private widgetRunning = false;
	private widgetLastVisualizerDraw = 0;
	private widgetRibbonEl: HTMLElement | null = null;
	private audioVisualizer: AudioVisualizer | null = null;

	async onload() {
		await this.loadSettings();

		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.setText("");

		this.liveTranscribe = new LiveTranscribeService({
			app: this.app,
			getAssemblyAiApiKey: () => this.settings.assemblyAiApiKey,
			onStatusText: (t) => this.updateStatusText(t),
			onRunningChange: (running) => this.updateWidgetState(running),
			onAudioFrame: (data) => this.updateVisualizer(data),
		});

		if (this.settings.showWidget) {
			this.initLiveWidget();
		}
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.attachWidgetToActiveEditor();
			})
		);

		this.widgetRibbonEl = this.createWidgetRibbon();
		this.updateRibbonState(this.settings.showWidget);

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const selection = editor.getSelection()?.trim();
				if (!selection) return;
				menu.addItem((item) => {
					item.setTitle("Summarize selection")
						.setIcon("sparkles")
						.onClick(() => {
							void this.runNotesAction(editor, "summary");
						});
				});
				menu.addItem((item) => {
					item.setTitle("Prettify selection")
						.setIcon("wand-2")
						.onClick(() => {
							void this.runNotesAction(editor, "prettify");
						});
				});
			})
		);

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
		this.widgetRibbonEl?.remove();
		this.widgetRibbonEl = null;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private updateStatusText(text: string) {
		const preview = (text || "").trim();
		if (this.widgetTranscriptEl) {
			this.widgetTranscriptEl.textContent = preview || "Say something to begin…";
		}
	}

	private updateWidgetState(running: boolean) {
		this.widgetRunning = running;
		if (this.widgetButtonEl) {
			this.widgetButtonEl.textContent = running ? "Stop" : "Start";
			this.widgetButtonEl.style.background = running
				? "var(--color-red)"
				: "var(--background-secondary)";
			this.widgetButtonEl.style.color = running ? "white" : "var(--text-normal)";
		}
		this.statusBarItemEl?.setText(running ? "Listening…" : "");
		if (this.widgetEl) {
			this.widgetEl.dataset.running = running ? "true" : "false";
		}
		if (running) {
			this.startWidgetTimer();
		} else {
			this.stopWidgetTimer();
			this.audioVisualizer?.update(null, false);
		}
	}

	setWidgetVisible(visible: boolean) {
		if (visible) {
			if (!this.widgetEl) {
				this.initLiveWidget();
			} else {
				this.attachWidgetToActiveEditor();
			}
		} else {
			this.destroyLiveWidget();
		}
		this.updateRibbonState(visible);
	}

	private createWidgetRibbon(): HTMLElement | null {
		const toggle = () => {
			const next = !this.settings.showWidget;
			this.settings.showWidget = next;
			void this.saveSettings();
			this.setWidgetVisible(next);
		};

		const tryAdd = (icon: string) => {
			try {
				return this.addRibbonIcon(icon, "Tuon: Toggle live widget", toggle);
			} catch {
				return null;
			}
		};

		return tryAdd("mic-vocal") ?? tryAdd("mic");
	}

	private updateRibbonState(visible: boolean) {
		if (!this.widgetRibbonEl) return;
		this.widgetRibbonEl.toggleClass("is-active", visible);
		this.widgetRibbonEl.setAttr("aria-pressed", visible ? "true" : "false");
		this.widgetRibbonEl.setAttr("aria-label", visible ? "Hide live widget" : "Show live widget");
	}

	private initLiveWidget() {
		if (this.widgetEl) return;
		const container = document.createElement("div");
		container.className = "tuon-live-transcribe-widget";
		container.setAttr("aria-live", "polite");
		container.dataset.running = "false";

		const header = document.createElement("div");
		header.style.display = "flex";
		header.style.alignItems = "center";
		header.style.justifyContent = "space-between";
		header.style.gap = "8px";

		const visualizerWrap = document.createElement("div");
		visualizerWrap.style.display = "flex";
		visualizerWrap.style.alignItems = "center";
		visualizerWrap.style.gap = "8px";

		const canvas = document.createElement("canvas");
		canvas.width = 120;
		canvas.height = 24;
		canvas.style.width = "120px";
		canvas.style.height = "24px";
		canvas.style.borderRadius = "6px";
		canvas.style.background = "var(--background-secondary)";

		const timer = document.createElement("span");
		timer.textContent = "00:00";
		timer.style.fontSize = "12px";
		timer.style.fontVariantNumeric = "tabular-nums";
		timer.style.opacity = "0.9";

		visualizerWrap.appendChild(canvas);
		visualizerWrap.appendChild(timer);

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

		header.appendChild(visualizerWrap);
		header.appendChild(button);

		const transcript = document.createElement("div");
		transcript.textContent = "Say something to begin…";
		transcript.style.fontSize = "12px";
		transcript.style.opacity = "0.9";
		transcript.style.marginBottom = "6px";
		transcript.style.whiteSpace = "pre-wrap";
		transcript.style.wordBreak = "break-word";
		transcript.style.maxHeight = "64px";
		transcript.style.overflow = "hidden";

		// Minimal inline styling to float in editor view.
		container.style.position = "absolute";
		container.style.left = "50%";
		container.style.bottom = "16px";
		container.style.transform = "translateX(-50%)";
		container.style.zIndex = "1000";
		container.style.display = "flex";
		container.style.flexDirection = "column";
		container.style.alignItems = "stretch";
		container.style.gap = "6px";
		container.style.padding = "10px 12px";
		container.style.borderRadius = "12px";
		container.style.background = "var(--background-primary)";
		container.style.boxShadow = "0 6px 20px rgba(0,0,0,0.2)";
		container.style.border = "1px solid var(--background-modifier-border)";
		container.style.backdropFilter = "blur(6px)";
		container.style.maxWidth = "390px";
		container.style.minWidth = "220px";
		container.style.width = "min(70vw, 390px)";

		container.appendChild(transcript);
		container.appendChild(header);

		this.widgetEl = container;
		this.widgetButtonEl = button;
		this.widgetTranscriptEl = transcript;
		this.widgetVisualizerCanvasEl = canvas;
		this.widgetTimerEl = timer;
		this.audioVisualizer = new AudioVisualizer({
			canvas,
			barWidth: 3,
			barGap: 1,
			sensitivity: 6,
			scrollSpeedPxPerSec: 12,
		});
		this.audioVisualizer.update(null, false);

		this.attachWidgetToActiveEditor();
	}

	private destroyLiveWidget() {
		if (this.widgetEl) {
			this.widgetEl.remove();
		}
		this.widgetEl = null;
		this.widgetButtonEl = null;
		this.widgetTranscriptEl = null;
		this.widgetVisualizerCanvasEl = null;
		this.widgetTimerEl = null;
		this.audioVisualizer = null;
		this.stopWidgetTimer();
	}

	private attachWidgetToActiveEditor() {
		if (!this.widgetEl) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const host = view?.contentEl;
		if (!host) return;

		// Ensure host is positionable so our absolute widget sits within it.
		const style = getComputedStyle(host);
		if (style.position === "static") {
			host.style.position = "relative";
		}

		if (this.widgetEl.parentElement !== host) {
			this.widgetEl.remove();
			host.appendChild(this.widgetEl);
		}
	}

	private startWidgetTimer() {
		if (this.widgetTimerIntervalId !== null) return;
		this.widgetTimerStart = Date.now();
		this.widgetTimerIntervalId = window.setInterval(() => {
			if (!this.widgetTimerEl || !this.widgetTimerStart) return;
			const elapsedMs = Date.now() - this.widgetTimerStart;
			this.widgetTimerEl.textContent = formatTimer(elapsedMs);
		}, 1000);
	}

	private stopWidgetTimer() {
		if (this.widgetTimerIntervalId !== null) {
			clearInterval(this.widgetTimerIntervalId);
			this.widgetTimerIntervalId = null;
		}
		this.widgetTimerStart = null;
		if (this.widgetTimerEl) {
			this.widgetTimerEl.textContent = "00:00";
		}
	}

	private updateVisualizer(data: Uint8Array) {
		if (!this.audioVisualizer) return;
		const now = Date.now();
		if (now - this.widgetLastVisualizerDraw < 33) return; // ~30fps
		this.widgetLastVisualizerDraw = now;
		this.audioVisualizer.update(data, this.widgetRunning);
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

function formatTimer(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
