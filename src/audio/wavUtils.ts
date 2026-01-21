export async function decodeAudioDataToBuffer(data: ArrayBuffer): Promise<AudioBuffer> {
	const AudioContextCtor =
		typeof window !== "undefined"
			? window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
			: undefined;
	if (!AudioContextCtor) {
		throw new Error("AudioContext is not available in this environment.");
	}
	const ctx = new AudioContextCtor();
	try {
		const copy = data.slice(0);
		return await ctx.decodeAudioData(copy);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to decode audio: ${msg}`);
	} finally {
		try {
			await ctx.close();
		} catch {}
	}
}

export async function resampleAudioBuffer(
	buffer: AudioBuffer,
	targetSampleRate: number
): Promise<AudioBuffer> {
	if (buffer.sampleRate === targetSampleRate) return buffer;
	const OfflineCtx =
		typeof window !== "undefined" ? window.OfflineAudioContext : undefined;
	if (!OfflineCtx) {
		throw new Error("OfflineAudioContext is not available in this environment.");
	}
	const targetLength = Math.ceil(buffer.duration * targetSampleRate);
	const ctx = new OfflineCtx(buffer.numberOfChannels, targetLength, targetSampleRate);
	const source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(ctx.destination);
	source.start(0);
	return await ctx.startRendering();
}

export function toMonoSamples(buffer: AudioBuffer): Float32Array {
	const { numberOfChannels, length } = buffer;
	if (numberOfChannels <= 1) {
		return new Float32Array(buffer.getChannelData(0));
	}
	const out = new Float32Array(length);
	for (let ch = 0; ch < numberOfChannels; ch++) {
		const channel = buffer.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			const sample = channel[i] ?? 0;
			const current = out[i] ?? 0;
			out[i] = current + sample / numberOfChannels;
		}
	}
	return out;
}

export function concatSamples(chunks: Float32Array[]): Float32Array {
	const totalLength = chunks.reduce((acc, cur) => acc + cur.length, 0);
	const out = new Float32Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

export function encodeWavFromMono(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const bytesPerSample = 2;
	const blockAlign = bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true); // PCM
	view.setUint16(20, 1, true); // format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 16, true); // bits per sample
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		const val = s < 0 ? s * 0x8000 : s * 0x7fff;
		view.setInt16(offset, val, true);
		offset += 2;
	}

	return buffer;
}

export function durationMsForSamples(sampleCount: number, sampleRate: number): number {
	if (!sampleRate || sampleRate <= 0) return 0;
	return Math.round((sampleCount / sampleRate) * 1000);
}

function writeString(view: DataView, offset: number, text: string) {
	for (let i = 0; i < text.length; i++) {
		view.setUint8(offset + i, text.charCodeAt(i));
	}
}
