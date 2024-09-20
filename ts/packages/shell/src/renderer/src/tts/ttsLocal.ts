// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

import { TTS, TTSMetrics } from "./tts";
import { createPlayQueue } from "./ttsAzure";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

async function synthesize(text: string) {
    const response = await fetch(
        `http://localhost:5002/api/tts?text=${encodeURIComponent(text)}&speaker_id=p376`,
    );

    if (response.ok) {
        const blob = await response.blob();
        return blob.arrayBuffer();
    } else {
        throw new Error(`Failed to fetch TTS: ${response.statusText}`);
    }
}

export async function getLocalVoices(): Promise<string[]> {
    return ["default"];
}
export function getLocalTTSProvider(): TTS {
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
                audio.onended = doneCallback;
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
                const data = await synthesize(text);
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
