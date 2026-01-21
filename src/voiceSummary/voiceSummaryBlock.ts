import { App, Notice, TFile } from "obsidian";
import { parse, stringify } from "yaml";

export const VOICE_SUMMARY_BLOCK_TYPE = "tuon-voice";

export interface VoiceSummaryMeta {
	transcriptHashAtSummary?: string;
	model?: string;
	updatedAt?: string;
}

export interface VoicePrettifyMeta {
	transcriptHashAtPrettify?: string;
	model?: string;
	updatedAt?: string;
}

export type RecordingMode = "stream" | "file";

export interface VoiceSummaryBlockData {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	recordingMode: RecordingMode;
	audioPath?: string;
	audioDurationMs?: number;
	transcript: string;
	summary: string;
	summaryMeta?: VoiceSummaryMeta;
	pretty: string;
	prettyMeta?: VoicePrettifyMeta;
}

export interface VoiceSummaryBlockMatch {
	start: number;
	end: number;
	raw: string;
	yaml: string;
	data?: VoiceSummaryBlockData;
	error?: string;
}

export function createVoiceSummaryBlockData(): VoiceSummaryBlockData {
	const now = new Date().toISOString();
	return {
		id: createVoiceSummaryId(),
		title: "Scribe",
		createdAt: now,
		updatedAt: now,
		recordingMode: "stream",
		audioPath: "",
		audioDurationMs: 0,
		transcript: "",
		summary: "",
		summaryMeta: {
			transcriptHashAtSummary: "",
			model: "",
			updatedAt: "",
		},
		pretty: "",
		prettyMeta: {
			transcriptHashAtPrettify: "",
			model: "",
			updatedAt: "",
		},
	};
}

export function buildVoiceSummaryFence(data: VoiceSummaryBlockData): string {
	const yaml = stringifyVoiceSummaryBlock(data);
	return `\`\`\`${VOICE_SUMMARY_BLOCK_TYPE}\n${yaml}\n\`\`\``;
}

export function parseVoiceSummaryBlock(source: string): {
	data?: VoiceSummaryBlockData;
	error?: string;
} {
	try {
		const parsed = parse(source) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object") {
			return { error: "Invalid YAML block." };
		}
		return { data: normalizeVoiceSummaryData(parsed) };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { error: msg };
	}
}

export function stringifyVoiceSummaryBlock(data: VoiceSummaryBlockData): string {
	const normalized = normalizeVoiceSummaryData(data as unknown as Record<string, unknown>);
	return stringify(
		{
			id: normalized.id,
			title: normalized.title,
			createdAt: normalized.createdAt,
			updatedAt: normalized.updatedAt,
			recordingMode: normalized.recordingMode,
			audioPath: normalized.audioPath ?? "",
			audioDurationMs: normalized.audioDurationMs ?? 0,
			transcript: normalized.transcript ?? "",
			summary: normalized.summary ?? "",
			summaryMeta: {
				transcriptHashAtSummary: normalized.summaryMeta?.transcriptHashAtSummary ?? "",
				model: normalized.summaryMeta?.model ?? "",
				updatedAt: normalized.summaryMeta?.updatedAt ?? "",
			},
			pretty: normalized.pretty ?? "",
			prettyMeta: {
				transcriptHashAtPrettify: normalized.prettyMeta?.transcriptHashAtPrettify ?? "",
				model: normalized.prettyMeta?.model ?? "",
				updatedAt: normalized.prettyMeta?.updatedAt ?? "",
			},
		},
		{ lineWidth: 0 }
	).trimEnd();
}

export function findVoiceSummaryBlocks(content: string): VoiceSummaryBlockMatch[] {
	const matches: VoiceSummaryBlockMatch[] = [];
	const fenceRegex = new RegExp(
		"```" + VOICE_SUMMARY_BLOCK_TYPE + "\\s*\\n([\\s\\S]*?)\\n```",
		"g"
	);
	for (const match of content.matchAll(fenceRegex)) {
		const raw = match[0];
		const yaml = match[1] ?? "";
		const start = match.index ?? 0;
		const end = start + raw.length;
		const parsed = parseVoiceSummaryBlock(yaml);
		matches.push({
			start,
			end,
			raw,
			yaml,
			data: parsed.data,
			error: parsed.error,
		});
	}
	return matches;
}

export function findVoiceSummaryBlockById(
	content: string,
	blockId: string
): VoiceSummaryBlockMatch | null {
	const matches = findVoiceSummaryBlocks(content);
	return matches.find((match) => match.data?.id === blockId) ?? null;
}

export async function updateVoiceSummaryBlockInFile(
	app: App,
	filePath: string,
	blockId: string,
	updater: (data: VoiceSummaryBlockData) => VoiceSummaryBlockData
): Promise<VoiceSummaryBlockData | null> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		new Notice("Could not find the note for this scribe block.");
		return null;
	}

	const content = await app.vault.read(file);
	const matches = findVoiceSummaryBlocks(content);
	const match = matches.find((m) => m.data?.id === blockId);
	if (!match || !match.data) {
		new Notice("Scribe block not found in this note.");
		return null;
	}

	const nextData = updater(match.data);
	const nextYaml = stringifyVoiceSummaryBlock(nextData);
	const nextFence = `\`\`\`${VOICE_SUMMARY_BLOCK_TYPE}\n${nextYaml}\n\`\`\``;
	const nextContent = content.slice(0, match.start) + nextFence + content.slice(match.end);
	await app.vault.modify(file, nextContent);
	return nextData;
}

export function getTranscriptHash(text: string): string {
	return hashFNV1a(text ?? "");
}

export function isSummaryStale(data: VoiceSummaryBlockData): boolean {
	const summary = (data.summary || "").trim();
	if (!summary) return false;
	const ref = data.summaryMeta?.transcriptHashAtSummary || "";
	if (!ref) return true;
	return ref !== getTranscriptHash(data.transcript || "");
}

export function isPrettyStale(data: VoiceSummaryBlockData): boolean {
	const pretty = (data.pretty || "").trim();
	if (!pretty) return false;
	const ref = data.prettyMeta?.transcriptHashAtPrettify || "";
	if (!ref) return true;
	return ref !== getTranscriptHash(data.transcript || "");
}

function normalizeVoiceSummaryData(raw: Record<string, unknown>): VoiceSummaryBlockData {
	const now = new Date().toISOString();
	const summaryMeta = (raw.summaryMeta ?? {}) as Record<string, unknown>;
	const prettyMeta = (raw.prettyMeta ?? {}) as Record<string, unknown>;
	return {
		id: coerceString(raw.id) || createVoiceSummaryId(),
		title: coerceString(raw.title) || "Scribe",
		createdAt: coerceString(raw.createdAt) || now,
		updatedAt: coerceString(raw.updatedAt) || now,
		recordingMode: normalizeRecordingMode(raw.recordingMode),
		audioPath: coerceString(raw.audioPath),
		audioDurationMs: coerceNumber(raw.audioDurationMs),
		transcript: coerceString(raw.transcript),
		summary: coerceString(raw.summary),
		summaryMeta: {
			transcriptHashAtSummary: coerceString(summaryMeta.transcriptHashAtSummary),
			model: coerceString(summaryMeta.model),
			updatedAt: coerceString(summaryMeta.updatedAt),
		},
		pretty: coerceString(raw.pretty),
		prettyMeta: {
			transcriptHashAtPrettify: coerceString(prettyMeta.transcriptHashAtPrettify),
			model: coerceString(prettyMeta.model),
			updatedAt: coerceString(prettyMeta.updatedAt),
		},
	};
}

function coerceString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

function coerceNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function normalizeRecordingMode(value: unknown): RecordingMode {
	const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
	return mode === "file" ? "file" : "stream";
}

function createVoiceSummaryId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `tuon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hashFNV1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
