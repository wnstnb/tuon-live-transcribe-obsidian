import { App, FuzzySuggestModal, TFile } from "obsidian";
import { isAudioFile } from "../audio/audioFileUtils";

export class AudioFilePickerModal extends FuzzySuggestModal<TFile> {
	private readonly onChoose: (file: TFile) => void;
	private readonly onCancel?: () => void;
	private didChoose = false;

	constructor(app: App, opts: { onChoose: (file: TFile) => void; onCancel?: () => void }) {
		super(app);
		this.onChoose = opts.onChoose;
		this.onCancel = opts.onCancel;
		this.setPlaceholder("Select an audio file");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter(isAudioFile);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.didChoose = true;
		this.onChoose(file);
	}

	onClose(): void {
		super.onClose();
		if (!this.didChoose) {
			this.onCancel?.();
		}
	}
}
