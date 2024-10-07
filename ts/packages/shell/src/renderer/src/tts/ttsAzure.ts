// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { getSpeechConfig } from "../speech";
import { getSpeechToken } from "../speechToken";
import { TTS, TTSMetrics } from "./tts";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

const defaultVoiceName = "en-US-AndrewMultilingualNeural";
const defaultVoiceStyle = "chat";

type PlayQueueItem = {
    cancel: () => void;
    play: (cbDone: () => void) => void;
};

type PlayQueue = {
    add: (item: PlayQueueItem) => void;
    cancel: () => void;
};

export function createPlayQueue(): PlayQueue {
    let current: PlayQueueItem | undefined = undefined;
    let playQueue: PlayQueueItem[] = [];

    const audioDone = () => {
        current = playQueue.shift();
        if (current) {
            current.play(audioDone);
        }
    };
    return {
        add(item: PlayQueueItem) {
            if (current === undefined) {
                current = item;
                current.play(audioDone);
            } else {
                playQueue.push(item);
            }
        },
        cancel() {
            const queue = playQueue;
            playQueue = [];
            if (current) {
                current.cancel();
                current = undefined;
            }
            for (const item of queue) {
                item.cancel();
            }
        },
    };
}

export function getAzureTTSProvider(voiceName?: string): TTS {
    let currentCancelId = 0;
    let nextId = 0;
    const queue = createPlayQueue();
    return {
        stop: () => {
            queue.cancel();
            currentCancelId++;
            nextId = 0;
        },
        speak: async (
            text: string,
            cbAudioStart?: () => void,
        ): Promise<TTSMetrics> => {
            const cancelId = currentCancelId;
            const callId = nextId++;
            const id = `${cancelId}:${callId}`;
            debug(`${id}: Speech Called: ${text}`);

            const start = performance.now();
            let firstChunkTime: number | undefined = undefined;
            let cleaned = false;
            let closed = false;
            const audioDestination = new speechSDK.SpeakerAudioDestination();
            const synthesizer: speechSDK.SpeechSynthesizer =
                new speechSDK.SpeechSynthesizer(
                    getSpeechConfig(await getSpeechToken())!,
                    speechSDK.AudioConfig.fromSpeakerOutput(audioDestination),
                );

            synthesizer.synthesisCompleted = () => {
                debug(`${id}: Synthesis ended`, performance.now() - start);
            };

            synthesizer.synthesizing = () => {
                if (firstChunkTime === undefined) {
                    firstChunkTime = performance.now() - start;
                    debug(`${id}: First chunk`, firstChunkTime);
                }
            };
            synthesizer.synthesisStarted = () => {
                debug(`${id}: Synthesis started`, performance.now() - start);
            };

            const cleanup = () => {
                if (cleaned) {
                    return false;
                }
                cbAudioStart = undefined;
                cleaned = true;
                audioDestination.pause();
                audioDestination.close();
                if (!closed) {
                    closed = true;
                    synthesizer.close();
                }
                return true;
            };

            let doneCallback: (() => void) | undefined;

            const finish = (success: boolean) => {
                if (doneCallback) {
                    // Call back if we are playing.
                    if (success) {
                        debug(
                            success
                                ? `${id}: Speech Ended`
                                : `${id}: Speech Skipped`,
                        );
                    }
                    doneCallback();
                    doneCallback = undefined;
                }
                cleanup();
            };

            if (cbAudioStart) {
                audioDestination.onAudioStart = cbAudioStart;
            }
            audioDestination.onAudioEnd = () => finish(true);
            audioDestination.pause();

            const item = {
                play: (cbDone: () => void) => {
                    if (cleaned) {
                        cbDone();
                        debug(`${id}: Speech Skipped`);
                        return;
                    }
                    if (doneCallback) {
                        throw new Error("Already playing");
                    }
                    doneCallback = cbDone;
                    debug(`${id}: Speech Playing`);
                    audioDestination.resume();
                },
                cancel: () => {
                    if (cleanup()) {
                        debug(`${id}: Speech Cancelled`);
                    }
                },
            };

            debug(`${id}: Speech Queueing`);
            queue.add(item);

            return new Promise<TTSMetrics>((resolve, reject) => {
                const ssml = `
                <speak
                    version='1.0'
                    xmlns='http://www.w3.org/2001/10/synthesis'
                    xmlns:mstts='https://www.w3.org/2001/mstts'
                    xml:lang='en-US'
                >
                    <voice name='${voiceName ?? defaultVoiceName}'>
                        <mstts:express-as style='${defaultVoiceStyle}'>
                            ${text}
                        </mstts:express-as>
                    </voice>
                </speak>`;
                synthesizer.speakSsmlAsync(
                    ssml,
                    (result) => {
                        synthesizer.close();
                        closed = true;
                        if (
                            result.reason ===
                            speechSDK.ResultReason.SynthesizingAudioCompleted
                        ) {
                            debug(`${id}: Synthesis Success`, result);

                            resolve({
                                duration: performance.now() - start,
                                firstChunkTime,
                            });

                            if (result.audioDuration === 0) {
                                // If the audio is empty, onAudioEnd won't be called
                                debug(`${id}: Empty Audio`);
                                finish(false);
                            }
                        } else {
                            debug(`${id}: Synthesis Failed`, result);
                            reject(result.errorDetails);
                            finish(false);
                        }
                    },
                    (error) => {
                        debugError(`${id}: Synthesis Error ${error}`);
                        synthesizer.close();
                        closed = true;
                        reject(error);
                        finish(false);
                    },
                );
            });
        },
    };
}

// Load once.
let azureVoicesP: Promise<[string, string][]> | undefined;
export async function getAzureVoices() {
    if (azureVoicesP === undefined) {
        azureVoicesP = (async () => {
            const synthesizer = new speechSDK.SpeechSynthesizer(
                getSpeechConfig(await getSpeechToken())!,
            );
            debug(`Getting azure voices for ${navigator.language}`);
            const result = await synthesizer.getVoicesAsync(navigator.language);
            synthesizer.close();
            if (result.reason !== speechSDK.ResultReason.VoicesListRetrieved) {
                // Try to load again next time.
                azureVoicesP = undefined;
                const errorMessage = `Failed to get voices: ${result.errorDetails}`;
                debugError(errorMessage);
                throw new Error(errorMessage);
            }
            debug("Got azure voices:", result.voices);
            return result.voices.map((v) => [v.displayName, v.shortName]);
        })();
    }
    return azureVoicesP;
}
