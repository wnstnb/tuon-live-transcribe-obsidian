import { App, Notice, TFile } from "obsidian";
import { parse, stringify } from "yaml";
import {
	buildVoiceSummaryStorageBlock,
	findVoiceSummaryStorageBlock,
} from "./voiceSummaryStorage";

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

export interface VoiceSummaryBlockMeta {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	recordingMode: RecordingMode;
	audioPath?: string;
	audioDurationMs?: number;
}

export interface VoiceSummaryBlockContent {
	transcript: string;
	summary: string;
	summaryMeta: VoiceSummaryMeta;
	pretty: string;
	prettyMeta: VoicePrettifyMeta;
}

export interface VoiceSummaryBlockData extends VoiceSummaryBlockMeta, VoiceSummaryBlockContent {}

export interface VoiceSummaryBlockParseResult {
	meta?: VoiceSummaryBlockMeta;
	legacyContent?: VoiceSummaryBlockContent;
	error?: string;
}

export interface VoiceSummaryBlockMatch {
	start: number;
	end: number;
	raw: string;
	yaml: string;
	meta?: VoiceSummaryBlockMeta;
	legacyContent?: VoiceSummaryBlockContent;
	error?: string;
}

export function createVoiceSummaryBlockMeta(): VoiceSummaryBlockMeta {
	const now = new Date().toISOString();
	return {
		id: createVoiceSummaryId(),
		title: "Scribe",
		createdAt: now,
		updatedAt: now,
		recordingMode: "stream",
		audioPath: "",
		audioDurationMs: 0,
	};
}

export function createVoiceSummaryBlockContent(): VoiceSummaryBlockContent {
	return {
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

export function createVoiceSummaryBlockData(): VoiceSummaryBlockData {
	return {
		...createVoiceSummaryBlockMeta(),
		...createVoiceSummaryBlockContent(),
	};
}

export function buildVoiceSummaryFence(meta: VoiceSummaryBlockMeta): string {
	const yaml = stringifyVoiceSummaryBlock(meta);
	return `\`\`\`${VOICE_SUMMARY_BLOCK_TYPE}\n${yaml}\n\`\`\``;
}

export function parseVoiceSummaryBlock(source: string): VoiceSummaryBlockParseResult {
	try {
		const parsed = parse(source) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object") {
			return { error: "Invalid YAML block." };
		}
		const meta = normalizeVoiceSummaryMeta(parsed);
		const legacyContent = hasLegacyContent(parsed)
			? normalizeVoiceSummaryContent(parsed)
			: undefined;
		return { meta, legacyContent };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { error: msg };
	}
}

export function stringifyVoiceSummaryBlock(data: VoiceSummaryBlockMeta): string {
	const normalized = normalizeVoiceSummaryMeta(data as unknown as Record<string, unknown>);
	return stringify(
		{
			id: normalized.id,
			title: normalized.title,
			createdAt: normalized.createdAt,
			updatedAt: normalized.updatedAt,
			recordingMode: normalized.recordingMode,
			audioPath: normalized.audioPath ?? "",
			audioDurationMs: normalized.audioDurationMs ?? 0,
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
			meta: parsed.meta,
			legacyContent: parsed.legacyContent,
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
	return matches.find((match) => match.meta?.id === blockId) ?? null;
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
	const match = matches.find((m) => m.meta?.id === blockId);
	if (!match || !match.meta) {
		new Notice("Scribe block not found in this note.");
		return null;
	}

	const storageMatch = findVoiceSummaryStorageBlock(content, blockId);
	const currentContent =
		storageMatch?.content ?? match.legacyContent ?? createVoiceSummaryBlockContent();
	const currentData: VoiceSummaryBlockData = {
		...match.meta,
		...currentContent,
	};

	const nextData = updater(currentData);
	const nextMeta = toVoiceSummaryBlockMeta(nextData);
	const nextContentData = toVoiceSummaryBlockContent(nextData);
	const nextYaml = stringifyVoiceSummaryBlock(nextMeta);
	const nextFence = `\`\`\`${VOICE_SUMMARY_BLOCK_TYPE}\n${nextYaml}\n\`\`\``;
	const nextStorage = buildVoiceSummaryStorageBlock(blockId, nextContentData);

	let nextContent: string;
	if (storageMatch) {
		nextContent = replaceRanges(content, [
			{ start: match.start, end: match.end, text: nextFence },
			{ start: storageMatch.start, end: storageMatch.end, text: nextStorage },
		]);
	} else {
		const withFence =
			content.slice(0, match.start) + nextFence + content.slice(match.end);
		const insertAt = match.start + nextFence.length;
		nextContent = insertStorageAfterFence(withFence, insertAt, nextStorage);
	}
	await app.vault.modify(file, nextContent);
	return nextData;
}

export async function migrateVoiceSummaryBlocksInFile(
	app: App,
	file: TFile
): Promise<boolean> {
	const content = await app.vault.cachedRead(file);
	const matches = findVoiceSummaryBlocks(content);
	if (!matches.length) return false;
	let didUpdate = false;
	for (const match of matches) {
		const blockId = match.meta?.id;
		if (!blockId) continue;
		const storageMatch = findVoiceSummaryStorageBlock(content, blockId);
		const needsMigration =
			!!match.legacyContent || !storageMatch || storageMatch.format === "comment";
		if (!needsMigration) continue;
		const updated = await updateVoiceSummaryBlockInFile(
			app,
			file.path,
			blockId,
			(current) => current
		);
		if (updated) {
			didUpdate = true;
		}
	}
	return didUpdate;
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

export function toVoiceSummaryBlockMeta(data: VoiceSummaryBlockData): VoiceSummaryBlockMeta {
	return normalizeVoiceSummaryMeta(data as unknown as Record<string, unknown>);
}

export function toVoiceSummaryBlockContent(data: VoiceSummaryBlockData): VoiceSummaryBlockContent {
	return normalizeVoiceSummaryContent(data as unknown as Record<string, unknown>);
}

function normalizeVoiceSummaryMeta(raw: Record<string, unknown>): VoiceSummaryBlockMeta {
	const now = new Date().toISOString();
	return {
		id: coerceString(raw.id) || createVoiceSummaryId(),
		title: coerceString(raw.title) || "Scribe",
		createdAt: coerceString(raw.createdAt) || now,
		updatedAt: coerceString(raw.updatedAt) || now,
		recordingMode: normalizeRecordingMode(raw.recordingMode),
		audioPath: coerceString(raw.audioPath),
		audioDurationMs: coerceNumber(raw.audioDurationMs),
	};
}

function normalizeVoiceSummaryContent(raw: Record<string, unknown>): VoiceSummaryBlockContent {
	const summaryMeta = (raw.summaryMeta ?? {}) as Record<string, unknown>;
	const prettyMeta = (raw.prettyMeta ?? {}) as Record<string, unknown>;
	return {
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

function hasLegacyContent(raw: Record<string, unknown>): boolean {
	return (
		"transcript" in raw ||
		"summary" in raw ||
		"pretty" in raw ||
		"summaryMeta" in raw ||
		"prettyMeta" in raw
	);
}

function replaceRanges(
	content: string,
	ranges: Array<{ start: number; end: number; text: string }>
): string {
	const ordered = [...ranges].sort((a, b) => b.start - a.start);
	let next = content;
	for (const range of ordered) {
		next = next.slice(0, range.start) + range.text + next.slice(range.end);
	}
	return next;
}

function insertStorageAfterFence(content: string, insertAt: number, storage: string): string {
	const before = content.slice(0, insertAt);
	const after = content.slice(insertAt);
	const prefix = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
	const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
	return `${before}${prefix}${storage}${suffix}${after}`;
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
