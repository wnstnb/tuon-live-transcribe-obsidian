import { App, Editor, MarkdownView, Notice } from "obsidian";
import { startMicPcm16Capture, MicCaptureHandle } from "../audio/micPcm16Capture";
import {
	AssemblyAiRealtimeClient,
	AssemblyAiTranscriptEvent,
} from "./assemblyAiRealtimeClient";

export interface LiveTranscribeServiceOptions {
	app: App;
	getAssemblyAiApiKey: () => string;
	onStatusText?: (text: string) => void;
	onRunningChange?: (running: boolean) => void;
	onAudioFrame?: (data: Uint8Array) => void;
}

export class LiveTranscribeService {
	private readonly app: App;
	private readonly getAssemblyAiApiKey: () => string;
	private readonly onStatusText?: (text: string) => void;
	private readonly onRunningChange?: (running: boolean) => void;
	private readonly onAudioFrame?: (data: Uint8Array) => void;

	private mic: MicCaptureHandle | null = null;
	private aai: AssemblyAiRealtimeClient | null = null;
	private unsubAai: (() => void) | null = null;

	private finalized = "";
	private current = "";
	private running = false;

	constructor(opts: LiveTranscribeServiceOptions) {
		this.app = opts.app;
		this.getAssemblyAiApiKey = opts.getAssemblyAiApiKey;
		this.onStatusText = opts.onStatusText;
		this.onRunningChange = opts.onRunningChange;
		this.onAudioFrame = opts.onAudioFrame;
	}

	get isRunning() {
		return this.running;
	}

	private getActiveEditor(): Editor | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
	}

	async start() {
		if (this.running) return;
		const apiKey = this.getAssemblyAiApiKey()?.trim();
		if (!apiKey) {
			new Notice("Missing AssemblyAI API key. Set it in plugin settings.");
			return;
		}

		this.finalized = "";
		this.current = "";
		this.running = true;
		this.onRunningChange?.(true);
		this.onStatusText?.("Starting transcription…");

		this.aai = new AssemblyAiRealtimeClient({ apiKey, sampleRate: 16000 });
		this.unsubAai = this.aai.onEvent((ev) => this.handleAaiEvent(ev));

		try {
			await this.aai.connect();
		} catch (e) {
			this.onStatusText?.("Failed to connect.");
			this.running = false;
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`AssemblyAI connect failed: ${msg}`);
			this.cleanup();
			return;
		}

		try {
			this.mic = await startMicPcm16Capture({
				chunkSizeSamples: 800, // 50ms
				onPcm16Chunk: (chunk) => {
					this.aai?.sendPcm16Chunk(chunk);
				},
				onAudioFrame: (data) => {
					this.onAudioFrame?.(data);
				},
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Microphone failed: ${msg}`);
			this.stop();
			return;
		}

		this.onStatusText?.("Listening…");
		new Notice("Live transcription started.");
	}

	stop() {
		if (!this.running) return;
		this.running = false;
		this.onRunningChange?.(false);
		this.onStatusText?.("Stopping…");
		this.cleanup();
		new Notice("Live transcription stopped.");
	}

	toggle() {
		if (this.running) this.stop();
		else void this.start();
	}

	private handleAaiEvent(ev: AssemblyAiTranscriptEvent) {
		if (ev.type === "transcript_update") {
			if (ev.is_final) {
				this.finalized += ev.text.trim() + " ";
				this.current = "";
				this.insertFinal(ev.text);
			} else {
				this.current = ev.text;
			}
			const preview = (this.finalized + this.current).trim();
			this.onStatusText?.(preview || "Listening…");
		} else if (ev.type === "error") {
			this.onStatusText?.("Transcription error.");
			new Notice(`Transcription error: ${ev.message}`);
			if (ev.message.toLowerCase().includes("not authorized")) {
				// Hard stop; auth problems won't recover without user action.
				this.stop();
			}
		}
	}

	private insertFinal(text: string) {
		const editor = this.getActiveEditor();
		if (!editor) return;
		const out = text.trim();
		if (!out) return;

		const cursor = editor.getCursor();
		const prefix = cursor.ch === 0 ? "" : " ";
		const insertion = prefix + out + " ";
		editor.replaceRange(insertion, cursor);
		// Move cursor to end of inserted text so subsequent transcripts append.
		const nextCursor = advanceCursor(cursor, insertion);
		editor.setCursor(nextCursor);
	}

	private cleanup() {
		try {
			this.unsubAai?.();
		} catch {}
		this.unsubAai = null;

		try {
			this.aai?.terminate();
		} catch {}
		this.aai = null;

		const mic = this.mic;
		this.mic = null;
		if (mic) {
			void mic.stop();
		}

		this.onStatusText?.("");
	}
}

function advanceCursor(
	cursor: { line: number; ch: number },
	text: string
): { line: number; ch: number } {
	const lines = text.split("\n");
	if (lines.length === 1) {
		const first = lines[0] ?? "";
		return { line: cursor.line, ch: cursor.ch + first.length };
	}
	const last = lines[lines.length - 1] ?? "";
	return { line: cursor.line + lines.length - 1, ch: last.length };
}

