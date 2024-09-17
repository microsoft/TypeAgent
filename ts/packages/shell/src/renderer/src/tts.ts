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

function getAzureTTSProvider(voiceName?: string): TTS | undefined {
    let currentCancelId = 0;
    let lastPromise: Promise<PhaseTiming> | undefined;
    let cancel: (() => void) | undefined;

    return {
        stop: () => {
            if (cancel !== undefined) {
                currentCancelId++;
                cancel();
            }
        },
        speak: async (
            text: string,
            voiceStyle?: string,
        ): Promise<PhaseTiming> => {
            const cancelId = currentCancelId;
            debug("Speech started");
            const start = performance.now();
            let firstChunkTime: number | undefined = undefined;

            while (lastPromise !== undefined) {
                await lastPromise;
                if (currentCancelId !== cancelId) {
                    debug("Speech cancelled");
                    throw new Error("Speech cancelled");
                }
            }

            const audioDestination = new speechSDK.SpeakerAudioDestination();
            const synthesizer = new speechSDK.SpeechSynthesizer(
                getSpeechConfig(await getSpeechToken())!,
                speechSDK.AudioConfig.fromSpeakerOutput(audioDestination),
            );

            synthesizer.synthesisCompleted = () => {
                debug("Synthesis ended", performance.now() - start);
            };

            synthesizer.synthesizing = () => {
                if (firstChunkTime === undefined) {
                    firstChunkTime = performance.now() - start;
                    debug("First chunk", firstChunkTime);
                }
            };
            synthesizer.synthesisStarted = () => {
                debug("Synthesis started", performance.now() - start);
            };

            lastPromise = new Promise<PhaseTiming>((resolve, reject) => {
                debug(`Speaking: ${text}`);
                let timing: PhaseTiming | undefined;
                let audioEnded = false;
                let finished = false;

                const cleanup = () => {
                    if (!finished) {
                        lastPromise = undefined;
                        cancel = undefined;
                        finished = true;

                        audioDestination.pause();
                        audioDestination.close();
                        return true;
                    }
                    return false;
                };
                const success = () => {
                    if (timing && audioEnded && cleanup()) {
                        resolve(timing);
                    }
                };

                const failed = (error: string) => {
                    if (cleanup()) {
                        reject(new Error(error));
                    }
                };

                cancel = () => {
                    debug("Cancelling speech");
                    if (cleanup()) {
                        if (timing) {
                            resolve(timing);
                        } else {
                            reject(new Error("Speech cancelled"));
                        }
                    }
                };

                audioDestination.onAudioEnd = () => {
                    debug("Speech ended");
                    audioEnded = true;
                    success();
                };

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
                        debug("Synthesis completed", result);
                        synthesizer.close();
                        if (
                            result.reason ===
                            speechSDK.ResultReason.SynthesizingAudioCompleted
                        ) {
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
                            success();
                            return;
                        }
                        failed(result.errorDetails);
                    },
                    (error) => {
                        debugError(`Synthesis error ${error}`);
                        synthesizer.close();
                        failed(error);
                    },
                );
            });
            return lastPromise;
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
