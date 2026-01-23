import type {
	VoicePrettifyMeta,
	VoiceSummaryBlockContent,
	VoiceSummaryMeta,
} from "./voiceSummaryBlock";
import { decodeBase64, encodeBase64 } from "../utils/base64";

const STORAGE_PREFIX = "tuon-scribe:storage:";
const STORAGE_VERSION = 1;
const STORAGE_BLOCK_CLASS = "tuon-scribe-storage";

interface VoiceSummaryStoragePayload {
	version: number;
	transcript: string;
	summary: string;
	pretty: string;
	summaryMeta: VoiceSummaryMeta;
	prettyMeta: VoicePrettifyMeta;
}

export interface VoiceSummaryStorageMatch {
	start: number;
	end: number;
	raw: string;
	json: string;
	payload: VoiceSummaryStoragePayload;
	content: VoiceSummaryBlockContent;
	format: "html" | "comment";
}

export function buildVoiceSummaryStorageBlock(
	blockId: string,
	content: VoiceSummaryBlockContent
): string {
	const payload: VoiceSummaryStoragePayload = {
		version: STORAGE_VERSION,
		transcript: encodeBase64(content.transcript ?? ""),
		summary: encodeBase64(content.summary ?? ""),
		pretty: encodeBase64(content.pretty ?? ""),
		summaryMeta: normalizeSummaryMeta(content.summaryMeta),
		prettyMeta: normalizePrettyMeta(content.prettyMeta),
	};
	const json = JSON.stringify(payload);
	return `<div class="${STORAGE_BLOCK_CLASS}" data-tuon-scribe-id="${blockId}">\n${json}\n</div>`;
}

export function findVoiceSummaryStorageBlock(
	content: string,
	blockId: string
): VoiceSummaryStorageMatch | null {
	const htmlMatch = findHtmlStorageBlock(content, blockId);
	if (htmlMatch) return htmlMatch;
	return findCommentStorageBlock(content, blockId);
}

export function decodeStoragePayload(payload: VoiceSummaryStoragePayload): VoiceSummaryBlockContent {
	return {
		transcript: decodeBase64(payload.transcript || ""),
		summary: decodeBase64(payload.summary || ""),
		pretty: decodeBase64(payload.pretty || ""),
		summaryMeta: normalizeSummaryMeta(payload.summaryMeta),
		prettyMeta: normalizePrettyMeta(payload.prettyMeta),
	};
}

function parseStoragePayload(json: string): VoiceSummaryStoragePayload | null {
	try {
		const parsed = JSON.parse(json) as Partial<VoiceSummaryStoragePayload>;
		if (!parsed || typeof parsed !== "object") return null;
		if (typeof parsed.transcript !== "string") return null;
		if (typeof parsed.summary !== "string") return null;
		if (typeof parsed.pretty !== "string") return null;
		const summaryMeta = normalizeSummaryMeta(parsed.summaryMeta);
		const prettyMeta = normalizePrettyMeta(parsed.prettyMeta);
		return {
			version: typeof parsed.version === "number" ? parsed.version : STORAGE_VERSION,
			transcript: parsed.transcript,
			summary: parsed.summary,
			pretty: parsed.pretty,
			summaryMeta,
			prettyMeta,
		};
	} catch (err) {
		console.warn("Failed to parse scribe storage payload:", err);
		return null;
	}
}

function normalizeSummaryMeta(meta?: VoiceSummaryMeta): VoiceSummaryMeta {
	return {
		transcriptHashAtSummary: meta?.transcriptHashAtSummary ?? "",
		model: meta?.model ?? "",
		updatedAt: meta?.updatedAt ?? "",
	};
}

function normalizePrettyMeta(meta?: VoicePrettifyMeta): VoicePrettifyMeta {
	return {
		transcriptHashAtPrettify: meta?.transcriptHashAtPrettify ?? "",
		model: meta?.model ?? "",
		updatedAt: meta?.updatedAt ?? "",
	};
}

function findHtmlStorageBlock(
	content: string,
	blockId: string
): VoiceSummaryStorageMatch | null {
	const escapedId = escapeRegExp(blockId);
	const pattern = new RegExp(
		`<div\\s+class="${STORAGE_BLOCK_CLASS}"\\s+data-tuon-scribe-id="${escapedId}"\\s*>\\s*([\\s\\S]*?)\\s*<\\/div>`,
		"i"
	);
	const match = pattern.exec(content);
	if (!match) return null;
	const raw = match[0] ?? "";
	const json = match[1] ?? "";
	const payload = parseStoragePayload(json);
	if (!payload) return null;
	const start = match.index ?? 0;
	const end = start + raw.length;
	const contentData = decodeStoragePayload(payload);
	return {
		start,
		end,
		raw,
		json,
		payload,
		content: contentData,
		format: "html",
	};
}

function findCommentStorageBlock(
	content: string,
	blockId: string
): VoiceSummaryStorageMatch | null {
	const pattern = new RegExp(
		`%%\\s*${escapeRegExp(STORAGE_PREFIX + blockId)}\\s*\\r?\\n([\\s\\S]*?)\\r?\\n%%`,
		"m"
	);
	const match = pattern.exec(content);
	if (!match) return null;
	const raw = match[0] ?? "";
	const json = match[1] ?? "";
	const payload = parseStoragePayload(json);
	if (!payload) return null;
	const start = match.index ?? 0;
	const end = start + raw.length;
	const contentData = decodeStoragePayload(payload);
	return {
		start,
		end,
		raw,
		json,
		payload,
		content: contentData,
		format: "comment",
	};
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
