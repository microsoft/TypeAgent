// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

import { TTS, TTSMetrics } from "./tts";
import { createPlayQueue } from "./ttsAzure";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

export async function getLocalVoices(): Promise<[string, string][]> {
    const response = await fetch("http://localhost:8002/voices");

    if (response.ok) {
        return await response.json();
    } else {
        throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }
}

async function synthesize(text: string, voiceName?: string) {
    const opt: RequestInit = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, voiceName }),
    };
    const response = await fetch(`http://localhost:8002/synthesize`, opt);

    if (response.ok) {
        const blob = await response.blob();
        return blob.arrayBuffer();
    } else {
        throw new Error(`Failed to fetch TTS: ${response.statusText}`);
    }
}

export function getLocalTTSProvider(voiceName?: string): TTS {
    let currentCancelId = 0;
    let nextId = 0;
    const queue = createPlayQueue();
    return {
        stop() {
            queue.cancel();
            currentCancelId++;
            nextId = 0;
        },
        async speak(
            text: string,
            cbAudioStart?: () => void,
        ): Promise<TTSMetrics | undefined> {
            const cancelId = currentCancelId;
            const callId = nextId++;
            const id = `${cancelId}:${callId}`;
            debug(`${id}: Speech Called: ${text}`);

            const start = performance.now();
            let cancel = false;
            let audioData: ArrayBuffer | undefined;
            let audio: HTMLAudioElement | undefined;
            let doneCallback: (() => void) | undefined;

            const startPlay = () => {
                if (
                    doneCallback === undefined ||
                    cancel ||
                    audioData === undefined ||
                    audio !== undefined
                ) {
                    return;
                }

                const blob = new Blob([audioData]);
                audio = new Audio(URL.createObjectURL(blob));
                audio.onended = () => {
                    debug(`${id}: Speech Ended`);
                    doneCallback!();
                };
                audio.play();
                cbAudioStart?.();
            };

            const item = {
                play(cbDone: () => void) {
                    if (cancel) {
                        cbDone();
                        debug(`${id}: Speech Skipped`);
                        return;
                    }
                    if (doneCallback) {
                        throw new Error("Already playing");
                    }
                    doneCallback = cbDone;
                    startPlay();

                    debug(`${id}: Speech Playing`);
                },
                cancel() {
                    if (!cancel) {
                        debug(`${id}: Speech Cancelled`);
                        cancel = true;
                        audio?.pause();
                    }
                },
            };
            queue.add(item);

            try {
                const data = await synthesize(text, voiceName);
                debug(`${id}: Synthesis Success`);
                audioData = data;
                startPlay();

                return {
                    duration: performance.now() - start,
                };
            } catch (err: any) {
                debugError(`${id}: Synthesis Error`, err.message);
                cancel = true;
                throw err;
            }
        },
    };
}
