// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Zero-dependency, web-native speech-to-text provider built on the browser's
 * Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
 *
 * ChatPanel uses this as the default `SpeechInputProvider` when the host does
 * not supply its own (e.g. the Electron shell injects an Azure/Whisper-backed
 * provider). It keeps the mic button working out of the box in plain browser
 * hosts without pulling any platform-specific SDK into chat-ui.
 *
 * NOTE: The Web Speech API is not available (or not functional) in every
 * environment — notably some Electron/VS Code webviews ship the constructor
 * but cannot reach a recognition backend. `createWebSpeechProvider()` returns
 * `undefined` when the constructor is missing so the mic button is simply not
 * rendered; recognition errors at runtime resolve the state back to idle.
 */

import type { SpeechInputProvider, SpeechState } from "./providers.js";

// Minimal structural typings for the Web Speech API, which is not part of the
// standard TypeScript DOM lib.
interface WebSpeechAlternative {
    transcript: string;
}
interface WebSpeechResult {
    isFinal: boolean;
    0: WebSpeechAlternative;
}
interface WebSpeechResultList {
    length: number;
    [index: number]: WebSpeechResult;
}
interface WebSpeechRecognitionEvent {
    resultIndex: number;
    results: WebSpeechResultList;
}
interface WebSpeechRecognition {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onend: (() => void) | null;
}
interface WebSpeechRecognitionCtor {
    new (): WebSpeechRecognition;
}

function getRecognitionCtor(): WebSpeechRecognitionCtor | undefined {
    if (typeof window === "undefined") return undefined;
    const w = window as unknown as {
        SpeechRecognition?: WebSpeechRecognitionCtor;
        webkitSpeechRecognition?: WebSpeechRecognitionCtor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

class WebSpeechProvider implements SpeechInputProvider {
    private readonly recognition: WebSpeechRecognition;
    private state: SpeechState = "idle";
    private resultCb?: (text: string, final: boolean) => void;
    private stateCb?: (state: SpeechState) => void;
    private continuous = false;

    constructor(ctor: WebSpeechRecognitionCtor) {
        this.recognition = new ctor();
        this.recognition.lang = "en-US";
        this.recognition.interimResults = true;
        this.recognition.continuous = false;

        this.recognition.onresult = (event) => {
            let interim = "";
            let final = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                const transcript = res[0]?.transcript ?? "";
                if (res.isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }
            if (interim) this.resultCb?.(interim, false);
            if (final) this.resultCb?.(final, true);
        };
        this.recognition.onerror = () => {
            // Recognition backend unreachable / permission denied / no speech.
            // Reset to idle so the mic button doesn't get stuck "listening".
            this.continuous = false;
            this.setState("idle");
        };
        this.recognition.onend = () => {
            if (this.continuous && this.state !== "idle") {
                // Continuous mode: the API stops after each utterance; restart
                // until the caller explicitly stops.
                try {
                    this.recognition.start();
                } catch {
                    this.setState("idle");
                }
            } else {
                this.setState("idle");
            }
        };
    }

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
            this.stop();
            return;
        }
        try {
            this.recognition.continuous = false;
            this.recognition.start();
            this.setState("listening");
        } catch {
            // start() throws if called while already running — treat as idle.
            this.setState("idle");
        }
    }

    public stop(): void {
        this.continuous = false;
        try {
            this.recognition.stop();
        } catch {
            // ignore — nothing was running
        }
        this.setState("idle");
    }

    public setContinuous(on: boolean): void {
        this.continuous = on;
        if (on) {
            try {
                this.recognition.continuous = true;
                this.recognition.start();
                this.setState("always-on");
            } catch {
                this.setState("idle");
            }
        } else {
            this.stop();
        }
    }
}

/**
 * Create a Web Speech API-backed {@link SpeechInputProvider}, or `undefined`
 * when the browser doesn't expose the API (so callers can skip rendering the
 * mic affordance).
 */
export function createWebSpeechProvider(): SpeechInputProvider | undefined {
    const ctor = getRecognitionCtor();
    if (!ctor) return undefined;
    try {
        return new WebSpeechProvider(ctor);
    } catch {
        return undefined;
    }
}
