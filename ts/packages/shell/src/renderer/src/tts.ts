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
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
        // No voice available;
        return undefined;
    }

    const voice = voiceName ? voices.find((v) => v.name === voiceName) : null;
    if (voice === undefined) {
        // specified voice not found
        return undefined;
    }
    return {
        speak: async (text: string) => {
            return new Promise((resolve, reject) => {
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

const defaultVoiceName = "en-US-LewisMultilingualNeural";
const defaultVoiceStyle = "chat";

function getAzureTTSProvider(voiceName?: string): TTS | undefined {
    return {
        speak: async (text: string, voiceStyle?: string) => {
            const synthesizer = new speechSDK.SpeechSynthesizer(
                getSpeechConfig(await getSpeechToken())!,
            );

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
                synthesizer.speakSsmlAsync(
                    ssml,
                    () => {
                        synthesizer.close();
                        resolve();
                    },
                    (error) => {
                        synthesizer.close();
                        reject(error);
                    },
                );
            });
        },
    };
}

let azureVoices: [string, string][] | undefined = undefined;
async function getAzureVoices() {
    if (azureVoices === undefined) {
        const synthesizer = new speechSDK.SpeechSynthesizer(
            getSpeechConfig(await getSpeechToken())!,
        );
        debug(`Getting voices for ${navigator.language}`);
        const result = await synthesizer.getVoicesAsync(navigator.language);
        synthesizer.close();
        if (result.reason === speechSDK.ResultReason.VoicesListRetrieved) {
            debug("Got voices:", result.voices);
            azureVoices = result.voices.map(
                (v) => [v.displayName, v.shortName] as [string, string],
            );
        } else {
            debugError(`Failed to get voices: ${result.errorDetails}`);
            azureVoices = [];
        }
    }
    return azureVoices;
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

export async function getTTSProviders() {
    const providers = [TTSProvider.Browser, TTSProvider.Azure];
    const voicesP = providers.map(
        async (p) => [p, await getTTSVoices(p)] as const,
    );
    return (await Promise.all(voicesP))
        .filter(([, voices]) => voices.length > 0)
        .map(([p]) => p);
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
