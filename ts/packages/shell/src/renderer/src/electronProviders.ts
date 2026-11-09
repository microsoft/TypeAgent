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
import { NemotronCapture } from "./nemotronCapture.js";

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
    private generation = 0;
    private localCapture?: NemotronCapture;
    private cancelRecognition?: () => void;

    constructor() {
        const unsubscribe = getClientAPI().onSpeechProviderChanged(() =>
            this.cancel(),
        );
        window.addEventListener(
            "beforeunload",
            () => {
                unsubscribe();
                this.cancel();
            },
            { once: true },
        );
    }

    private cancel() {
        this.generation++;
        this.localCapture?.cancel();
        this.localCapture = undefined;
        this.cancelRecognition?.();
        this.cancelRecognition = undefined;
        this.continuousRecognizer?.stop();
        this.continuousRecognizer = undefined;
        this.continuous = false;
        this.setState("idle");
    }

    private reportError(error: unknown) {
        this.cancel();
        const message = error instanceof Error ? error.message : String(error);
        void getClientAPI()
            .reportSpeechError(message)
            .catch((failure: unknown) =>
                console.error("Unable to display speech error", failure),
            );
    }

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
            this.stop();
            return;
        }
        if (this.state === "preparing" || this.state === "finalizing") return;
        const generation = this.generation + 1;
        void this.startSingleShot().catch((error: unknown) => {
            if (generation === this.generation) this.reportError(error);
        });
    }

    private async startSingleShot(): Promise<void> {
        const generation = ++this.generation;
        this.setState("preparing");
        const provider = await getClientAPI().getSpeechProvider();
        if (generation !== this.generation) return;
        if (provider === "nemotron") {
            const capture = new NemotronCapture(getClientAPI(), {
                result: (text, final) => {
                    if (generation !== this.generation) return;
                    this.resultCb?.(text, final);
                    if (final) {
                        this.localCapture = undefined;
                        this.setState("idle");
                    }
                },
                listening: () => {
                    if (generation === this.generation)
                        this.setState("listening");
                },
                finalizing: () => {
                    if (generation === this.generation)
                        this.setState("finalizing");
                },
                error: (error) => {
                    if (generation === this.generation) this.reportError(error);
                },
            });
            this.localCapture = capture;
            await capture.start();
            return;
        }
        const useLocalWhisper = provider === "whisper";
        if (useLocalWhisper) await getClientAPI().getLocalWhisperStatus();
        const token: SpeechToken | undefined = needSpeechToken(useLocalWhisper)
            ? await getSpeechToken(false)
            : undefined;
        if (generation !== this.generation) return;
        if (needSpeechToken(useLocalWhisper) && token === undefined) {
            this.setState("disabled");
            return;
        }
        this.setState("listening");
        this.cancelRecognition = recognizeOnce(
            token,
            (text) => {
                if (generation === this.generation)
                    this.resultCb?.(text, false);
            },
            (text) => {
                if (generation !== this.generation) return;
                this.resultCb?.(text, true);
                if (!this.continuous) this.setState("idle");
            },
            (error) => {
                if (generation === this.generation) this.reportError(error);
            },
            useLocalWhisper,
        );
    }

    public stop(): void {
        if (this.localCapture) {
            void this.localCapture
                .finish()
                .catch((error: unknown) => this.reportError(error));
            return;
        }
        if (this.continuous) {
            this.setContinuous(false);
        } else {
            this.cancel();
        }
    }

    public setContinuous(on: boolean, waitForWakeWord = false): void {
        this.continuous = on;
        this.waitForWakeWord = waitForWakeWord;
        if (on) {
            const generation = this.generation + 1;
            void this.startContinuous().catch((error: unknown) => {
                if (generation === this.generation) this.reportError(error);
            });
        } else {
            this.cancel();
        }
    }

    private async startContinuous(): Promise<void> {
        const generation = ++this.generation;
        this.cancelRecognition?.();
        this.cancelRecognition = undefined;
        const provider = await getClientAPI().getSpeechProvider();
        if (generation !== this.generation) return;
        if (provider === "nemotron") {
            throw new Error(
                "Nemotron currently supports single-shot input only. Use the mic button or Alt+M.",
            );
        }
        const useLocalWhisper = provider === "whisper";
        if (useLocalWhisper) await getClientAPI().getLocalWhisperStatus();
        const token: SpeechToken | undefined = needSpeechToken(useLocalWhisper)
            ? await getSpeechToken(false)
            : undefined;
        if (generation !== this.generation) return;
        if (needSpeechToken(useLocalWhisper) && !token) {
            this.continuous = false;
            this.setState("disabled");
            return;
        }
        if (this.continuousRecognizer === undefined) {
            this.continuousRecognizer = new ContinousSpeechRecognizer(
                useLocalWhisper,
                token,
                (text) => {
                    if (generation === this.generation)
                        this.resultCb?.(text, false);
                },
                (text) => {
                    if (generation === this.generation)
                        this.resultCb?.(text, true);
                },
                (error) => {
                    if (generation === this.generation) this.reportError(error);
                },
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
