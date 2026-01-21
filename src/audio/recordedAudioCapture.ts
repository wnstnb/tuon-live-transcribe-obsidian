export interface RecordedAudioData {
	blob: Blob;
	mimeType: string;
	extension: string;
	durationMs: number;
}

export interface RecordedAudioCaptureHandle {
	stop: () => Promise<RecordedAudioData>;
}

export interface RecordedAudioCaptureOptions {
	onAudioFrame?: (data: Uint8Array | null) => void;
}

export async function startRecordedAudioCapture(
	opts: RecordedAudioCaptureOptions = {}
): Promise<RecordedAudioCaptureHandle> {
	const hasGetUserMedia =
		typeof navigator !== "undefined" &&
		!!navigator.mediaDevices &&
		typeof navigator.mediaDevices.getUserMedia === "function";
	if (!hasGetUserMedia) {
		throw new Error("Microphone capture is not supported in this environment.");
	}
	if (typeof MediaRecorder === "undefined") {
		throw new Error("MediaRecorder is not supported in this environment.");
	}

	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const mimeType = pickSupportedMimeType();
	const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
	const startedAt = Date.now();
	const chunks: BlobPart[] = [];

	let audioContext: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let rafId: number | null = null;
	const onAudioFrame = opts.onAudioFrame;

	if (onAudioFrame) {
		const AudioContextCtor =
			typeof window !== "undefined"
				? window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
				: undefined;
		if (AudioContextCtor) {
			try {
				audioContext = new AudioContextCtor();
				analyser = audioContext.createAnalyser();
				analyser.fftSize = 2048;
				source = audioContext.createMediaStreamSource(stream);
				source.connect(analyser);
				const data = new Uint8Array(analyser.frequencyBinCount);
				const tick = () => {
					try {
						analyser?.getByteTimeDomainData(data);
						onAudioFrame(new Uint8Array(data));
					} catch {
						// ignore
					}
					rafId = requestAnimationFrame(tick);
				};
				rafId = requestAnimationFrame(tick);
			} catch {
				// Visualizer is optional; continue recording without it.
				try {
					audioContext?.close();
				} catch {}
				audioContext = null;
				analyser = null;
				source = null;
				rafId = null;
			}
		}
	}

	let stopped = false;
	let resolveStop: ((data: RecordedAudioData) => void) | null = null;
	let rejectStop: ((err: Error) => void) | null = null;

	const stopPromise = new Promise<RecordedAudioData>((resolve, reject) => {
		resolveStop = resolve;
		rejectStop = reject;
	});

	recorder.addEventListener("dataavailable", (event: BlobEvent) => {
		if (event.data && event.data.size > 0) {
			chunks.push(event.data);
		}
	});

	recorder.addEventListener("error", () => {
		const err = new Error("Audio recording failed.");
		rejectStop?.(err);
	});

	recorder.addEventListener("stop", () => {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		onAudioFrame?.(null);
		try {
			source?.disconnect();
		} catch {}
		try {
			analyser?.disconnect();
		} catch {}
		try {
			if (audioContext && audioContext.state !== "closed") {
				void audioContext.close();
			}
		} catch {}
		try {
			stream.getTracks().forEach((track) => track.stop());
		} catch {}
		const resolvedType = recorder.mimeType || mimeType || "audio/webm";
		const blob = new Blob(chunks, { type: resolvedType });
		const extension = extensionForMime(resolvedType);
		const durationMs = Math.max(0, Date.now() - startedAt);
		resolveStop?.({
			blob,
			mimeType: resolvedType,
			extension,
			durationMs,
		});
	});

	recorder.start();

	return {
		stop: async () => {
			if (!stopped) {
				stopped = true;
				recorder.stop();
			}
			return stopPromise;
		},
	};
}

function pickSupportedMimeType(): string {
	if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
		return "";
	}
	const candidates = [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/ogg;codecs=opus",
		"audio/ogg",
		"audio/mp4",
		"audio/mpeg",
		"audio/wav",
	];
	return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function extensionForMime(mimeType: string): string {
	const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (base === "audio/webm") return "webm";
	if (base === "audio/ogg") return "ogg";
	if (base === "audio/mp4" || base === "audio/m4a") return "m4a";
	if (base === "audio/mpeg") return "mp3";
	if (base === "audio/wav" || base === "audio/wave") return "wav";
	return "webm";
}
