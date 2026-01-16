export interface AudioVisualizerOptions {
	canvas: HTMLCanvasElement;
	barWidth?: number;
	barGap?: number;
	sensitivity?: number;
	idleThreshold?: number;
}

export class AudioVisualizer {
	private readonly canvas: HTMLCanvasElement;
	private readonly barWidth: number;
	private readonly barGap: number;
	private readonly sensitivity: number;
	private readonly idleThreshold: number;

	constructor(opts: AudioVisualizerOptions) {
		this.canvas = opts.canvas;
		this.barWidth = opts.barWidth ?? 3;
		this.barGap = opts.barGap ?? 1;
		this.sensitivity = opts.sensitivity ?? 6;
		this.idleThreshold = opts.idleThreshold ?? 0.01;
	}

	update(data: Uint8Array | null | undefined, isActive: boolean) {
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;

		const { width, height } = this.getCanvasSize(ctx);
		ctx.clearRect(0, 0, width, height);

		const colors = this.getColors();
		if (!isActive || !data || data.length === 0) {
			this.resetMotion();
			this.drawIdle(ctx, width, height, colors.inactive);
			return;
		}

		const rms = this.computeRms(data);
		if (rms < this.idleThreshold) {
			this.resetMotion();
			this.drawIdle(ctx, width, height, colors.inactive);
			return;
		}

		const totalBarWidth = this.barWidth + this.barGap;
		const bars = Math.max(1, Math.floor(width / totalBarWidth));

		for (let i = 0; i < bars; i++) {
			const dataIndex = Math.floor((i / Math.max(1, bars - 1)) * (data.length - 1));
			const clampedIndex = Math.max(0, Math.min(dataIndex, data.length - 1));
			const value = data[clampedIndex] ?? 128;
			const sample = (value - 128) / 128;
			const amplitude = Math.min(1, Math.abs(sample) * this.sensitivity);
			const barHeight = Math.max(2, Math.floor(amplitude * height));
			const x = i * totalBarWidth;
			const y = Math.floor((height - barHeight) / 2);

			ctx.fillStyle = colors.active;
			ctx.globalAlpha = 1.0;
			ctx.fillRect(x, y, this.barWidth, barHeight);
		}
	}

	private drawIdle(ctx: CanvasRenderingContext2D, width: number, height: number, color: string) {
		ctx.fillStyle = color;
		ctx.globalAlpha = 0.3;
		ctx.fillRect(0, height / 2 - 0.5, width, 1);
		ctx.globalAlpha = 1.0;
	}

	private resetMotion() {
		// No-op in static mode; keep for compatibility.
	}

	private computeRms(data: Uint8Array): number {
		let rms = 0;
		for (let i = 0; i < data.length; i++) {
			const value = data[i] ?? 128;
			const sample = (value - 128) / 128;
			rms += sample * sample;
		}
		return Math.sqrt(rms / data.length);
	}

	private getCanvasSize(ctx: CanvasRenderingContext2D): { width: number; height: number } {
		const rect = this.canvas.getBoundingClientRect();
		const cssWidth = rect.width || this.canvas.width;
		const cssHeight = rect.height || this.canvas.height;
		const scale = window.devicePixelRatio || 1;

		const width = Math.max(1, Math.floor(cssWidth));
		const height = Math.max(1, Math.floor(cssHeight));

		if (this.canvas.width !== Math.floor(width * scale) || this.canvas.height !== Math.floor(height * scale)) {
			this.canvas.width = Math.floor(width * scale);
			this.canvas.height = Math.floor(height * scale);
		}
		ctx.setTransform(scale, 0, 0, scale, 0, 0);
		return { width, height };
	}

	private getColors(): { active: string; inactive: string } {
		const computed = getComputedStyle(document.documentElement);
		const accent =
			computed.getPropertyValue("--text-accent").trim() ||
			computed.getPropertyValue("--color-accent").trim();
		const muted =
			computed.getPropertyValue("--text-muted").trim() ||
			computed.getPropertyValue("--text-faint").trim();
		return {
			active: accent || "#f87171",
			inactive: muted || "#94a3b8",
		};
	}
}
