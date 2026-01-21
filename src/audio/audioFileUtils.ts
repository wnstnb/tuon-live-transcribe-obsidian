import { TFile } from "obsidian";

const AUDIO_EXTENSIONS = new Set([
	"aac",
	"flac",
	"m4a",
	"mp3",
	"ogg",
	"wav",
	"webm",
]);

export function isAudioFile(file: TFile): boolean {
	return AUDIO_EXTENSIONS.has(file.extension.toLowerCase());
}

export function buildRecordingFilename(extension: string, date = new Date()): string {
	const safeExt = extension.replace(/^\./, "") || "webm";
	const pad = (value: number) => String(value).padStart(2, "0");
	const stamp = [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
	].join("-");
	const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(".");
	return `Tuon Recording ${stamp} ${time}.${safeExt}`;
}
