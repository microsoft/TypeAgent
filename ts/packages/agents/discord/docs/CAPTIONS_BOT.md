# Discord Live Captions Bot — Design Document

## Overview

The live captions bot joins a Discord voice channel, transcribes speech in real-time using Azure Cognitive Services Speech SDK, and posts rolling caption messages to a designated text channel via the existing TypeAgent Discord REST agent. It runs as a persistent sidecar bot process (separate from the TypeAgent dispatcher) that is started/stopped through new TypeAgent actions. The bot is stateful — it maintains a single active voice connection per guild — and bridges the gap between Discord's gateway WebSocket protocol (required for voice) and the REST-only actions the current Discord agent exposes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  TypeAgent Dispatcher                                       │
│    discord agent actions                                    │
│      startTranscription / stopTranscription /               │
│      configureTranscription                                 │
│           │  HTTP control plane (localhost)                 │
└───────────┼─────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────┐
│  Bot Process  (Node, long-lived)                            │
│                                                             │
│  discord.js Gateway WS  ←──── Discord voice gateway        │
│  @discordjs/voice                                           │
│    VoiceConnection → AudioReceiver                          │
│      per-user Opus stream                                   │
│           │                                                 │
│  prism-media OpusDecoder                                    │
│    → 16-bit PCM 16 kHz mono                                 │
│           │                                                 │
│  Azure Speech SDK                                           │
│    PushAudioInputStream.write(pcmChunk)                     │
│    SpeechRecognizer (continuous)                            │
│    onRecognized → transcript text                           │
│           │                                                 │
│  Caption poster                                             │
│    batch / debounce → Discord REST createMessage            │
│    (uses existing TypeAgent discord agent internals         │
│     or direct fetch with BOT_TOKEN)                         │
└─────────────────────────────────────────────────────────────┘
```

### Audio pipeline detail

1. `@discordjs/voice` `AudioReceiver` emits per-SSRC Opus packets for each speaking user.
2. Each stream is piped through a `prism-media` `OpusDecoder` configured for 16 kHz mono (Azure Speech SDK input format).
3. Decoded PCM chunks are written to a `PushAudioInputStream`; one `SpeechRecognizer` per active speaker (or a single shared one if diarization is used).
4. `recognizing` events give low-latency partials; `recognized` events give final segments.
5. Final segments are queued and flushed to the caption text channel via Discord REST `POST /channels/{id}/messages` (can reuse the existing discord agent `createMessage` logic or call directly with `DISCORD_BOT_TOKEN`).

---

## New TypeAgent Actions Needed

```typescript
// discordSchema.ts additions

type StartTranscription = {
  actionName: "startTranscription";
  parameters: {
    voiceChannelId: string; // channel to join
    captionChannelId: string; // text channel to post captions to
    guildId: string;
    language?: string; // BCP-47, default "en-US"
  };
};

type StopTranscription = {
  actionName: "stopTranscription";
  parameters: {
    guildId: string;
  };
};

type ConfigureTranscription = {
  actionName: "configureTranscription";
  parameters: {
    guildId: string;
    language?: string;
    silenceThresholdMs?: number; // flush partial after N ms silence
    captionChannelId?: string; // redirect output channel
  };
};

type GetTranscriptionStatus = {
  actionName: "getTranscriptionStatus";
  parameters: {
    guildId: string;
  };
};
```

The action handler communicates with the bot process over a local HTTP control API (e.g., `localhost:47890`). `startTranscription` POSTs a join command; `stopTranscription` signals disconnect; `configureTranscription` hot-reloads settings.

---

## Key Packages Needed

| Package                               | Purpose                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `discord.js`                          | Gateway WebSocket client, guild/channel resolution         |
| `@discordjs/voice`                    | Voice channel join, `AudioReceiver`, Opus stream           |
| `prism-media`                         | Opus → PCM decoding (`OpusDecoder`)                        |
| `@azure/cognitiveservices-speech-sdk` | Streaming `SpeechRecognizer`, `PushAudioInputStream`       |
| `express` (or `fastify`)              | Lightweight local control API for action handler → bot IPC |

---

## Discord Bot Permissions Required

**Gateway Intents** (must be enabled in Discord Developer Portal):

- `GUILDS`
- `GUILD_VOICE_STATES` — required to join voice and receive audio
- `GUILD_MESSAGES` — to post captions

**OAuth2 Scopes** (bot invite URL):

- `bot`
- `applications.commands` (if slash commands added later)

**Bot Permissions**:

- `Connect` — join voice channels
- `Speak` — (needed for voice connection even if bot only listens)
- `Send Messages` — post captions to text channel
- `View Channel` — read channel metadata

---

## Environment Variables

| Variable              | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`   | Bot token from Discord Developer Portal (needed for gateway auth) |
| `SPEECH_SDK_KEY`      | Azure Speech resource key                                         |
| `SPEECH_SDK_ENDPOINT` | Custom endpoint URL (if using private endpoint)                   |
| `SPEECH_SDK_REGION`   | Azure region (e.g., `eastus`) — used if no custom endpoint        |

All sourced from `ts/.env` via `dotenv`. The bot process loads them at startup.

---

## Implementation Sketch

```typescript
// bot/captionsBot.ts (long-lived process)

import { Client, GatewayIntentBits } from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
} from "@discordjs/voice";
import { OpusDecoder } from "prism-media";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function startTranscription({
  voiceChannelId,
  captionChannelId,
  guildId,
  language,
}) {
  const guild = await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(voiceChannelId);

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, // must be false to receive audio
  });

  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId) => {
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
    });

    const decoder = new OpusDecoder({ rate: 16000, channels: 1 });
    const pushStream = sdk.AudioInputStream.createPushStream(
      sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
    );

    opusStream.pipe(decoder).on("data", (chunk) => pushStream.write(chunk));
    opusStream.on("end", () => pushStream.close());

    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const speechConfig = sdk.SpeechConfig.fromEndpoint(
      new URL(process.env.SPEECH_SDK_ENDPOINT),
      process.env.SPEECH_SDK_KEY,
    );
    speechConfig.speechRecognitionLanguage = language ?? "en-US";

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognized = async (_, e) => {
      if (
        e.result.reason === sdk.ResultReason.RecognizedSpeech &&
        e.result.text
      ) {
        await postCaption(captionChannelId, userId, e.result.text);
      }
    };

    recognizer.startContinuousRecognitionAsync();
  });
}

async function postCaption(channelId, userId, text) {
  // Direct REST call using bot token
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: `[<@${userId}>]: ${text}` }),
  });
}

// Control API (for TypeAgent action handler to call)
// POST /start  { voiceChannelId, captionChannelId, guildId, language }
// POST /stop   { guildId }
// GET  /status { guildId }
```

---

## Known Challenges

- **Multi-speaker diarization**: `receiver.speaking` fires per userId so per-user `SpeechRecognizer` instances work naturally, but this creates N SDK sessions simultaneously. May hit Azure concurrency limits; consider a shared recognizer with speaker diarization enabled (`SpeakerDiarizationConfig`).

- **Silence detection & caption chunking**: Short silences mid-sentence trigger `AfterSilence` end behavior prematurely. Tune `duration` threshold per use case; `recognizing` partials can be used to display interim captions in a single edited message (Discord message edit via `PATCH /messages/{id}`).

- **Opus packet format**: Discord sends 48 kHz stereo Opus; Azure Speech SDK expects 16 kHz mono PCM. The `OpusDecoder` must be configured correctly (`rate: 16000, channels: 1`) — discord.js voice sends 48 kHz by default so resampling may be needed (use `prism-media` FFmpeg decoder as fallback).

- **Bot process lifecycle**: The bot process is separate from the TypeAgent dispatcher. It must be started before `startTranscription` actions work. Options: (a) auto-start on first action, (b) start as a background service, (c) add a `startBot` action. Need a cleanup strategy (disconnect voice, close recognizers) on process exit.

- **Rate limits**: Posting a caption message per recognized segment can hit Discord's rate limits (5 messages/5 sec per channel). Consider batching segments or editing the last message rather than creating new ones.

- **Token security**: `DISCORD_BOT_TOKEN` must not be exposed to the TypeAgent LLM context. Keep it server-side in the bot process only.
