export interface AudioVisualizerOptions {
	canvas: HTMLCanvasElement;
	barWidth?: number;
	barGap?: number;
	sensitivity?: number;
	scrollSpeedPxPerSec?: number;
}

export class AudioVisualizer {
	private readonly canvas: HTMLCanvasElement;
	private readonly barWidth: number;
	private readonly barGap: number;
	private readonly sensitivity: number;
	private readonly scrollSpeedPxPerSec: number;

	private audioHistory: number[] = [];
	private scrollOffset = 0;
	private lastUpdateTime = 0;
	private lastHistoryUpdate = 0;

	constructor(opts: AudioVisualizerOptions) {
		this.canvas = opts.canvas;
		this.barWidth = opts.barWidth ?? 3;
		this.barGap = opts.barGap ?? 1;
		this.sensitivity = opts.sensitivity ?? 6;
		this.scrollSpeedPxPerSec = opts.scrollSpeedPxPerSec ?? 12;
	}

	update(data: Uint8Array | null | undefined, isActive: boolean) {
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;

		const { width, height } = this.getCanvasSize(ctx);
		ctx.clearRect(0, 0, width, height);

		const colors = this.getColors();
		if (!isActive || !data || data.length === 0) {
			this.drawIdle(ctx, width, height, colors.inactive);
			return;
		}

		const totalBarWidth = this.barWidth + this.barGap;
		const barsNeeded = Math.ceil(width / totalBarWidth) + 8;
		const numberOfBars = Math.floor(width / totalBarWidth) + 8;

		const now = Date.now();
		if (this.lastUpdateTime > 0) {
			const deltaTime = now - this.lastUpdateTime;
			this.scrollOffset += (deltaTime / 1000) * this.scrollSpeedPxPerSec;
			const maxOffset = totalBarWidth * barsNeeded;
			if (this.scrollOffset > maxOffset) {
				this.scrollOffset = this.scrollOffset % maxOffset;
			}
		}
		this.lastUpdateTime = now;

		if (now - this.lastHistoryUpdate >= 30) {
			let rms = 0;
			for (let i = 0; i < data.length; i++) {
				const value = data[i] ?? 128;
				const sample = (value - 128) / 128;
				rms += sample * sample;
			}
			rms = Math.sqrt(rms / data.length);

			this.audioHistory.push(rms);
			if (this.audioHistory.length > 100) {
				this.audioHistory.shift();
			}
			this.lastHistoryUpdate = now;
		}

		for (let i = 0; i < barsNeeded; i++) {
			const baseX = width - i * totalBarWidth;
			const x = baseX - (this.scrollOffset % (barsNeeded * totalBarWidth));

			let finalX = x;
			if (x < -this.barWidth) {
				finalX = x + barsNeeded * totalBarWidth;
			}
			if (finalX + this.barWidth < 0 || finalX > width) continue;

			let barHeight = 2;
			if (i < 5) {
				const dataIndex = Math.floor((i / 5) * data.length);
				const clampedIndex = Math.min(dataIndex, data.length - 1);
				const value = data[clampedIndex] ?? 128;
				const sample = (value - 128) / 128;
				barHeight = Math.abs(sample) * height * (this.sensitivity * 0.5);
			} else {
				const historyIndex = i - 5;
				if (historyIndex < this.audioHistory.length) {
					const historicalLevel =
						this.audioHistory[this.audioHistory.length - 1 - historyIndex] ?? 0;
					barHeight = historicalLevel * height * this.sensitivity;
				}
			}

			barHeight = Math.max(2, Math.min(barHeight, height * 0.6));

			const y = (height - barHeight) / 2;
			const fadeOpacity = Math.max(0.1, 1 - (i / numberOfBars) * 0.7);

			ctx.fillStyle = colors.active;
			ctx.globalAlpha = fadeOpacity;
			ctx.fillRect(finalX, y, this.barWidth, barHeight);
			ctx.globalAlpha = 1.0;
		}
	}

	private drawIdle(ctx: CanvasRenderingContext2D, width: number, height: number, color: string) {
		ctx.fillStyle = color;
		ctx.globalAlpha = 0.3;
		ctx.fillRect(0, height / 2 - 0.5, width, 1);
		ctx.globalAlpha = 1.0;
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
