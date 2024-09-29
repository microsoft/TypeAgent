// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

import { TTS } from "./tts";

const debug = registerDebug("typeagent:shell:tts");
const debugError = registerDebug("typeagent:shell:tts:error");

export function getBrowserTTSProvider(voiceName?: string): TTS {
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
