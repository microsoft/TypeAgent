// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Electron implementations of the chat-ui capability providers
 * (SpeechInputProvider / TtsProvider / ImageCaptureProvider). These wrap
 * the existing shell renderer speech, TTS, and file/camera plumbing so the
 * shared ChatPanel can render the mic / attach / camera affordances while
 * the platform-specific logic stays here in the shell.
 */

import type {
    ImageCaptureProvider,
    SpeechInputProvider,
    SpeechState,
    TtsMetrics,
    TtsProvider,
} from "@typeagent/chat-ui";
import type {
    SpeechToken,
    ShellUserSettings,
} from "../../preload/electronTypes";
import { getClientAPI } from "./main";
import { getSpeechToken } from "./speechToken";
import {
    ContinousSpeechRecognizer,
    needSpeechToken,
    recognizeOnce,
} from "./speech";
import { getTTS, TTS } from "./tts/tts";

/**
 * Speech-to-text provider backed by the shell's Azure / local-Whisper
 * recognizers. Manages the idle / listening / always-on / wake-word state
 * machine and surfaces recognized text to ChatPanel via onResult.
 */
export class ElectronSpeechProvider implements SpeechInputProvider {
    private state: SpeechState = "idle";
    private resultCb?: (text: string, final: boolean) => void;
    private stateCb?: (state: SpeechState) => void;
    private continuousRecognizer?: ContinousSpeechRecognizer;
    private continuous = false;
    private waitForWakeWord = false;

    public getState(): SpeechState {
        return this.state;
    }

    private setState(state: SpeechState) {
        this.state = state;
        this.stateCb?.(state);
    }

    public onResult(cb: (text: string, final: boolean) => void): void {
        this.resultCb = cb;
    }

    public onStateChange(cb: (state: SpeechState) => void): void {
        this.stateCb = cb;
    }

    public start(): void {
        if (this.state === "listening") {
            // Toggle off an in-progress single-shot recognition.
            this.setState("idle");
            return;
        }
        void this.startSingleShot();
    }

    private async startSingleShot(): Promise<void> {
        const useLocalWhisper = await getClientAPI().getLocalWhisperStatus();
        const token: SpeechToken | undefined = needSpeechToken(useLocalWhisper)
            ? await getSpeechToken(false)
            : undefined;
        if (needSpeechToken(useLocalWhisper) && token === undefined) {
            this.setState("disabled");
            return;
        }
        this.setState("listening");
        recognizeOnce(
            token,
            (text) => this.resultCb?.(text, false),
            (text) => {
                this.resultCb?.(text, true);
                if (!this.continuous) this.setState("idle");
            },
            () => {
                if (!this.continuous) this.setState("idle");
            },
            useLocalWhisper,
        );
    }

    public stop(): void {
        if (this.continuous) {
            this.setContinuous(false);
        } else {
            this.setState("idle");
        }
    }

    public setContinuous(on: boolean, waitForWakeWord = false): void {
        this.continuous = on;
        this.waitForWakeWord = waitForWakeWord;
        if (on) {
            void this.startContinuous();
        } else {
            this.continuousRecognizer?.stop();
            this.setState("idle");
        }
    }

    private async startContinuous(): Promise<void> {
        const useLocalWhisper = await getClientAPI().getLocalWhisperStatus();
        const token: SpeechToken | undefined = needSpeechToken(useLocalWhisper)
            ? await getSpeechToken(false)
            : undefined;
        if (this.continuousRecognizer === undefined) {
            this.continuousRecognizer = new ContinousSpeechRecognizer(
                useLocalWhisper,
                token,
                (text) => this.resultCb?.(text, false),
                (text) => this.resultCb?.(text, true),
                () => {},
            );
        }
        this.continuousRecognizer.start();
        this.setState(this.waitForWakeWord ? "wake-word" : "always-on");
    }
}

/**
 * Text-to-speech provider backed by the shell's TTS factory. Reads the
 * current provider/voice and enabled state from the live shell settings.
 */
export class ElectronTtsProvider implements TtsProvider {
    private tts: TTS | undefined;
    private lastProvider?: string;
    private lastVoice?: string;

    constructor(private readonly getSettings: () => ShellUserSettings) {}

    public isEnabled(): boolean {
        return this.getSettings().tts === true;
    }

    private ensureTts(): TTS | undefined {
        const { provider, voice } = this.getSettings().ttsSettings;
        if (
            this.tts === undefined ||
            provider !== this.lastProvider ||
            voice !== this.lastVoice
        ) {
            this.tts = getTTS(provider, voice);
            this.lastProvider = provider;
            this.lastVoice = voice;
        }
        return this.tts;
    }

    public async speak(
        text: string,
        onAudioStart?: () => void,
    ): Promise<TtsMetrics | undefined> {
        const tts = this.ensureTts();
        if (!tts) return undefined;
        return tts.speak(text, onAudioStart);
    }

    public stop(): void {
        this.tts?.stop();
    }
}

/**
 * Image-capture provider. `pickFile` opens the Electron file dialog (a
 * fire-and-forget IPC call) and resolves when the main process pushes the
 * chosen file back via Client.fileSelected — the bridge calls
 * `resolvePickedFile` to fulfill the pending promise. `openCamera` is wired
 * by the bridge to the shell's CameraView.
 */
export class ElectronImageCaptureProvider implements ImageCaptureProvider {
    private pendingPick?: (urls: string[] | undefined) => void;

    constructor(
        private readonly cameraCapture?: () => Promise<string | undefined>,
    ) {}

    public pickFile(): Promise<string[] | undefined> {
        // Only one outstanding pick at a time; resolve any prior one empty.
        this.pendingPick?.(undefined);
        return new Promise<string[] | undefined>((resolve) => {
            this.pendingPick = resolve;
            getClientAPI().openImageFile();
        });
    }

    /** Called by the bridge from Client.fileSelected with the chosen image. */
    public resolvePickedFile(dataUrl: string | undefined): void {
        const resolve = this.pendingPick;
        this.pendingPick = undefined;
        resolve?.(dataUrl ? [dataUrl] : undefined);
    }

    public get openCamera(): (() => Promise<string | undefined>) | undefined {
        return this.cameraCapture;
    }
}
