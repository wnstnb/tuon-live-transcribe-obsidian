# Tuon Scribe

Tuon Scribe brings live transcription and AI-assisted notes into Obsidian. Stream mic audio to AssemblyAI for realtime text, capture transcripts in a scribe block, and use OpenRouter to summarize or clean up text.

## Features

- Live transcription with AssemblyAI realtime streaming.
- Floating live widget and status updates.
- Scribe block with transcript, summary, and prettified text.
- Summarize or prettify selections with OpenRouter.
- Optional timestamps for transcripts.
- Live transcription requires a mic

## Commands

- Tuon: Toggle live transcription
- Tuon: Start live transcription
- Tuon: Stop live transcription
- Tuon: Summarize selection (OpenRouter)
- Tuon: Prettify selection (OpenRouter)
- Tuon: Insert scribe block
- Tuon: Test AssemblyAI API key
- Tuon: Test OpenRouter API key

## Setup

1. Open **Settings -> Community plugins** and select **Tuon Scribe**.
2. Add your AssemblyAI API key for live transcription.
3. Add your OpenRouter API key and model for summaries and prettify.

Plugin id: `tuon-scribe`.

## Scribe block

Use the "Tuon: Insert scribe block" command to insert a `tuon-voice` code block. The block UI lets you record, review transcripts, and generate summary or prettified text.

## Privacy and external services

- Live transcription streams microphone audio to AssemblyAI.
- Summary and prettify send selected text or transcript text to OpenRouter.
- API keys are stored locally in Obsidian plugin settings.

## Development

- `npm install`
- `npm run dev`
- `npm run build`

## Manual installation

Copy `manifest.json`, `main.js`, and `styles.css` into:
`<Vault>/.obsidian/plugins/tuon-scribe/`

## License

0BSD
