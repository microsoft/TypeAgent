// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { getSpeechConfig } from "./speech";
import { getSpeechToken } from "./speechToken";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

export const enum TTSProvider {
    Browser = "browser",
    Azure = "azure",
}

export type TTS = {
    speak(text: string): Promise<void>;
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
            return new Promise((resolve, reject) => {
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
                    resolve();
                });
                speechSynthesis.speak(utterance);
            });
        },
    };
}

const defaultVoiceName = "en-US-AndrewMultilingualNeural";
const defaultVoiceStyle = "chat";

function getAzureTTSProvider(voiceName?: string): TTS | undefined {
    return {
        speak: async (text: string, voiceStyle?: string) => {
            const synthesizer = new speechSDK.SpeechSynthesizer(
                getSpeechConfig(await getSpeechToken())!,
                speechSDK.AudioConfig.fromDefaultSpeakerOutput(),
            );
            synthesizer.synthesisCompleted = () => {
                debug("Synthesis ended");
            };

            synthesizer.synthesisStarted = () => {
                debug("Synthesis started");
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

            return await new Promise<void>((resolve, reject) => {
                debug(`Speaking: ${text}`);
                synthesizer.speakSsmlAsync(
                    ssml,
                    () => {
                        synthesizer.close();
                        resolve();
                    },
                    (error) => {
                        synthesizer.close();
                        debugError(`Speech error ${error}`);
                        reject(error);
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
