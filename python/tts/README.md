# Local Text to speech server for TypeAgent shell

This directory contains examples of local Text to speech (TTS) server that works with the [TypeAgent shell](../../ts/packages/shell/). Additional TTS service for TypeAgent Shell can be built following the [REST API](#rest-api) description below.

## Usage

- Go to one of the TTS directory
- Follow the direction in the directory to setup .venv and start the service
- In [TypeAgent shell](../../ts/packages/shell/), change the TTS provider to local and choose a voice.

## REST API

The local TTS provider in TypeAgent expects two REST API:

### `GET /voices`

Return the available voices a JSON array of strings (`string[]`) or array of name, value string pair (`[string, string][]`).

### `POST /synthesize`

Body is a JSON object with the following typescript schema

```typescript
{
    text: string
    voiceName?: string
}
```

`text` - the text to synthesize speech for
`voiceName` - an optional voice name value from the `GET /voices`. The services will pick a default voice if it is missing.

Return a blob containing the synthesized speech in WAV format.
