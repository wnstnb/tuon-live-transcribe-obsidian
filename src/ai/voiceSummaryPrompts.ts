export type NotesAction = "summary" | "prettify";

export function buildSystemPrompt(action: NotesAction): string {
	if (action === "summary") {
		// Adapted from Tuon `/api/voice-summary/generate-notes` (summary mode)
		return `You are an expert at creating concise, informative summaries from voice transcriptions.

Your task is to:
1. Create a clear, well-structured summary
2. Extract key points and insights
3. Organize information logically
4. Use markdown formatting for better readability
5. Include relevant context when provided

Keep the summary comprehensive yet concise.`;
	}

	// Adapted from Tuon `/api/voice-summary/generate-notes` (prettify mode) + `/api/prettify-transcript`
	return `You are an expert at cleaning up and formatting voice transcriptions.

Your task is to:
1. Clean up filler words, repetitions, and false starts (lightly; don't change meaning)
2. Add proper punctuation and capitalization
3. Break into logical paragraphs
4. Preserve the original meaning and tone (do not summarize)
5. Use simple markdown formatting for readability
6. Remove markers like "--- Recording Started ---" and similar session markers

Make the transcription more readable while keeping it authentic.`;
}

export function buildUserPrompt(params: {
	action: NotesAction;
	transcription: string;
	recordingStartTime?: string;
}): string {
	const ts = params.recordingStartTime ? `Recording Time: ${params.recordingStartTime}\n\n` : "";
	if (params.action === "summary") {
		return `Please create a summary of this voice transcription:

${ts}Transcription:
${params.transcription}`;
	}

	return `Please clean up and format this voice transcription:

${ts}Raw Transcription:
${params.transcription}`;
}

