// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * VS Code webview implementation of chat-ui's `SpeechInputProvider`, backed by
 * Azure Speech. The browser Web Speech API is not functional inside VS Code
 * webviews, so the shell injects this provider to override chat-ui's default.
 *
 * The `speech:` config lives on the agent server; this provider obtains a
 * short-lived authorization token via a host round-trip (`requestToken`) and
 * runs single-shot recognition with the browser Speech SDK. It mirrors the
 * Electron shell's `recognizeOnce` flow (see shell/renderer/src/speech.ts).
 */

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import type { SpeechInputProvider, SpeechState } from "chat-ui";
import type { SpeechToken } from "@typeagent/agent-server-protocol";

export class VsCodeAzureSpeechProvider implements SpeechInputProvider {
    private state: SpeechState = "idle";
    private resultCb?: (text: string, final: boolean) => void;
    private stateCb?: (state: SpeechState) => void;
    private recognizer?: speechSDK.SpeechRecognizer;
    // Client-side token cache; the server also caches, but this avoids a
    // host round-trip on every mic click within the token's lifetime.
    private cachedToken?: SpeechToken;

    /**
     * @param requestToken Fetches a fresh Azure Speech token from the host
     *   (relayed to the agent server). Resolves to undefined when speech is
     *   not configured.
     */
    constructor(
        private readonly requestToken: () => Promise<SpeechToken | undefined>,
    ) {}

    public getState(): SpeechState {
        return this.state;
    }

    private setState(state: SpeechState): void {
        if (this.state === state) return;
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
            // Toggle off an in-progress recognition.
            this.stop();
            return;
        }
        void this.startSingleShot();
    }

    private async getToken(): Promise<SpeechToken | undefined> {
        if (this.cachedToken && this.cachedToken.expire > Date.now()) {
            return this.cachedToken;
        }
        const token = await this.requestToken();
        this.cachedToken = token;
        return token;
    }

    private async startSingleShot(): Promise<void> {
        let token: SpeechToken | undefined;
        try {
            token = await this.getToken();
        } catch {
            token = undefined;
        }
        if (!token) {
            // Speech not configured / token unavailable — reflect a disabled
            // mic so the user gets feedback rather than a silent no-op.
            this.setState("disabled");
            return;
        }

        let reco: speechSDK.SpeechRecognizer;
        try {
            // Identity (AAD) tokens are passed as `aad#<endpoint>#<token>`;
            // key-issued tokens (no endpoint) are passed verbatim.
            const authToken = token.endpoint
                ? `aad#${token.endpoint}#${token.token}`
                : token.token;
            const speechConfig = speechSDK.SpeechConfig.fromAuthorizationToken(
                authToken,
                token.region,
            );
            speechConfig.speechRecognitionLanguage = "en-US";
            const audioConfig =
                speechSDK.AudioConfig.fromDefaultMicrophoneInput();
            reco = new speechSDK.SpeechRecognizer(speechConfig, audioConfig);
        } catch {
            this.setState("idle");
            return;
        }

        this.recognizer = reco;
        this.setState("listening");

        reco.recognizing = (_s, e) => {
            this.resultCb?.(e.result.text, false);
        };
        reco.recognizeOnceAsync(
            (result) => {
                if (
                    result.reason === speechSDK.ResultReason.RecognizedSpeech &&
                    result.text
                ) {
                    this.resultCb?.(result.text, true);
                }
                this.cleanup();
            },
            () => {
                // Recognition error (no mic permission, network, etc.).
                this.cleanup();
            },
        );
    }

    public stop(): void {
        this.cleanup();
    }

    public setContinuous(_on: boolean, _waitForWakeWord?: boolean): void {
        // Continuous / wake-word modes are not supported in the webview yet;
        // the mic button drives single-shot recognition only.
    }

    private cleanup(): void {
        const reco = this.recognizer;
        this.recognizer = undefined;
        if (reco) {
            try {
                reco.close();
            } catch {
                // ignore — recognizer may already be torn down
            }
        }
        this.setState("idle");
    }
}
