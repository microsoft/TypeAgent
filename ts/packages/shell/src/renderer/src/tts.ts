// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { getSpeechConfig } from "./speech";
import { getSpeechToken } from "./speechToken";
import { PhaseTiming } from "agent-dispatcher";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

export const enum TTSProvider {
    Browser = "browser",
    Azure = "azure",
}

export type TTS = {
    speak(text: string): Promise<PhaseTiming | undefined>;
    stop(): void;
};

function getBrowserTTSProvider(voiceName?: string): TTS | undefined {
    return {
        speak: async (text: string) => {
            const voices = speechSynthesis.getVoices();
            if (voices.length === 0) {
                // No voice available;
                debugError("No voice available");
                return;
            }

            const voice = voiceName
                ? voices.find((v) => v.name === voiceName)
                : null;
            if (voice === undefined) {
                // specified voice not found
                debugError(`${voiceName} not available`);
                return;
            }
            return new Promise<undefined>((resolve, reject) => {
                debug(`Speaking: ${text}`);
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.voice = voice;
                utterance.addEventListener("start", () => {
                    debug("Speech started");
                });
                utterance.addEventListener("error", (ev) => {
                    debug(`Speech error: ${ev.error}`);
                    reject(ev.error);
                });
                utterance.addEventListener("end", () => {
                    debug("Speech ended");
                    resolve(undefined);
                });
                speechSynthesis.speak(utterance);
            });
        },
        stop: () => {
            speechSynthesis.cancel();
        },
    };
}

const defaultVoiceName = "en-US-AndrewMultilingualNeural";
const defaultVoiceStyle = "chat";

type PlayQueueItem = {
    cancel: () => void;
    play: () => void;
};

function getAzureTTSProvider(voiceName?: string): TTS | undefined {
    let current: PlayQueueItem | undefined = undefined;
    let playQueue: PlayQueueItem[] = [];
    let currentCancelId = 0;
    let nextId = 0;
    return {
        stop: () => {
            const queue = playQueue;
            playQueue = [];
            if (current) {
                current.cancel();
                current = undefined;
            }
            for (const item of queue) {
                item.cancel();
            }
            currentCancelId++;
            nextId = 0;
        },
        speak: async (
            text: string,
            voiceStyle?: string,
        ): Promise<PhaseTiming> => {
            const cancelId = currentCancelId;
            const callId = nextId++;
            const id = `${cancelId}:${callId}`;
            debug(`${id}: Speech Called: ${text}`);

            const start = performance.now();
            let firstChunkTime: number | undefined = undefined;
            let empty = false;
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
                cleaned = true;
                audioDestination.pause();
                audioDestination.close();
                if (!closed) {
                    closed = true;
                    synthesizer.close();
                }
                return true;
            };

            const finish = () => {
                if (cleanup()) {
                    debug(`${id}: Speech Ended`);
                    current = playQueue.shift();
                    current?.play();
                }
            };

            audioDestination.onAudioEnd = finish;

            const item = {
                play: () => {
                    if (!cleaned) {
                        if (empty) {
                            debug(`${id}: Speech Skipped`);
                            // If the audio is empty, onAudioEnd won't be called;
                            finish();
                        } else {
                            debug(`${id}: Speech Playing`);
                            audioDestination.resume();
                        }
                    }
                },
                cancel: () => {
                    if (cleanup()) {
                        debug(`${id}: Speech Cancelled`);
                    }
                },
            };

            if (current === undefined) {
                current = item;
                debug(`${id}: Speech Playing`);
            } else {
                debug(`${id}: Speech Queueing`);
                playQueue.push(item);
                audioDestination.pause();
            }

            const remove = () => {
                empty = true;
                if (item === current) {
                    // If the audio is empty, onAudioEnd won't be called;
                    finish();
                }
            };

            return new Promise<PhaseTiming>((resolve, reject) => {
                let timing: PhaseTiming | undefined;

                const ssml = `
                <speak
                    version='1.0'
                    xmlns='http://www.w3.org/2001/10/synthesis'
                    xmlns:mstts='https://www.w3.org/2001/mstts'
                    xml:lang='en-US'
                >
                    <voice name='${voiceName ?? defaultVoiceName}'>
                        <mstts:express-as style='${voiceStyle ?? defaultVoiceStyle}'>
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
                            timing = {
                                duration: performance.now() - start,
                            };
                            if (firstChunkTime !== undefined) {
                                timing.marks = {
                                    "First Chunk": {
                                        duration: firstChunkTime,
                                        count: 1,
                                    },
                                };
                            }
                            resolve(timing);

                            if (result.audioDuration === 0) {
                                // If the audio is empty, onAudioEnd won't be called
                                debug(`${id}: Empty Audio`);
                                remove();
                            }
                        } else {
                            debug(`${id}: Synthesis Failed`, result);
                            reject(result.errorDetails);
                            remove();
                        }
                    },
                    (error) => {
                        debugError(`${id}: Synthesis error ${error}`);
                        synthesizer.close();
                        closed = true;
                        reject(error);
                        remove();
                    },
                );
            });
        },
    };
}

// Load once.
let azureVoicesP: Promise<[string, string][]> | undefined;
async function getAzureVoices() {
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

export async function getTTSVoices(
    provider: string,
): Promise<string[] | [string, string][]> {
    switch (provider) {
        case TTSProvider.Browser:
            return speechSynthesis.getVoices().map((v) => v.name);
        case TTSProvider.Azure:
            return getAzureVoices();
        default:
            return [];
    }
}

export function getTTSProviders() {
    return [TTSProvider.Browser, TTSProvider.Azure];
}

export function getTTS(provider?: string, voiceName?: string): TTS | undefined {
    switch (provider) {
        case TTSProvider.Browser:
            return getBrowserTTSProvider(voiceName);
        case TTSProvider.Azure:
            return getAzureTTSProvider(voiceName);
        case undefined:
            return (
                // Default toe azure tts first
                getAzureTTSProvider(voiceName) ??
                getBrowserTTSProvider(voiceName)
            );
        default:
            return undefined;
    }
}
