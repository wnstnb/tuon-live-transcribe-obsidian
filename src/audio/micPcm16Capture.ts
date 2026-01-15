export interface MicCaptureOptions {
	/** PCM16 mono samples at 16kHz, delivered as an ArrayBuffer backing an Int16Array. */
	onPcm16Chunk: (pcm16: ArrayBuffer) => void;
	/** Size in samples to batch before emitting. 800 samples @ 16kHz = 50ms. */
	chunkSizeSamples?: number;
}

export interface MicCaptureHandle {
	stop: () => Promise<void>;
}

const DEFAULT_CHUNK_SIZE_SAMPLES = 800; // 50ms at 16kHz

// AudioWorklet code: buffers Float32 samples and emits Int16 PCM buffers.
function buildAudioWorkletProcessorCode() {
	// Note: this code runs in the AudioWorklet global scope.
	return `
class TuonPcm16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = (options && options.processorOptions && options.processorOptions.chunkSize) || ${DEFAULT_CHUNK_SIZE_SAMPLES};
    this._buf = new Float32Array(this.chunkSize);
    this._pos = 0;
  }

  process(inputs) {
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      this._buf[this._pos++] = input[i];
      if (this._pos === this.chunkSize) {
        const out = new Int16Array(this.chunkSize);
        for (let j = 0; j < this.chunkSize; j++) {
          let s = Math.max(-1, Math.min(1, this._buf[j]));
          out[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this._pos = 0;
      }
    }
    return true;
  }
}

registerProcessor('tuon-pcm16', TuonPcm16Processor);
`;
}

export async function startMicPcm16Capture(
	opts: MicCaptureOptions
): Promise<MicCaptureHandle> {
	const chunkSizeSamples = opts.chunkSizeSamples ?? DEFAULT_CHUNK_SIZE_SAMPLES;

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			// Requesting 16kHz helps but isn't guaranteed; we force an AudioContext at 16kHz below.
			sampleRate: 16000,
		},
	});

	const audioContext = new AudioContext({ sampleRate: 16000 });
	const source = audioContext.createMediaStreamSource(stream);

	const workletBlob = new Blob([buildAudioWorkletProcessorCode()], {
		type: "application/javascript",
	});
	const workletUrl = URL.createObjectURL(workletBlob);
	await audioContext.audioWorklet.addModule(workletUrl);
	URL.revokeObjectURL(workletUrl);

	const workletNode = new AudioWorkletNode(audioContext, "tuon-pcm16", {
		processorOptions: { chunkSize: chunkSizeSamples },
	});

	workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
		try {
			if (event.data instanceof ArrayBuffer) {
				opts.onPcm16Chunk(event.data);
			}
		} catch {
			// ignore errors; capture should be resilient
		}
	};

	// Connect graph. Don't connect to destination to avoid echoing mic audio.
	source.connect(workletNode);

	const stop = async () => {
		try {
			workletNode.port.onmessage = null;
		} catch {}
		try {
			workletNode.disconnect();
		} catch {}
		try {
			source.disconnect();
		} catch {}
		try {
			stream.getTracks().forEach((t) => t.stop());
		} catch {}
		try {
			if (audioContext.state !== "closed") await audioContext.close();
		} catch {}
	};

	return { stop };
}

