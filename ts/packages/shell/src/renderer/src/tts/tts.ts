// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getAzureTTSProvider, getAzureVoices } from "./ttsAzure";
import { getBrowserTTSProvider } from "./ttsBrowser";
import { getLocalTTSProvider, getLocalVoices } from "./ttsLocal";

export const enum TTSProvider {
    Browser = "browser",
    Azure = "azure",
    Local = "local",
}

export type TTS = {
    speak(
        text: string,
        cbAudioStart?: () => void,
    ): Promise<TTSMetrics | undefined>;
    stop(): void;
};

export type TTSMetrics = {
    firstChunkTime?: number;
    duration: number;
};

export async function getTTSVoices(
    provider: string,
): Promise<string[] | [string, string][]> {
    switch (provider) {
        case TTSProvider.Browser:
            return speechSynthesis.getVoices().map((v) => v.name);
        case TTSProvider.Azure:
            return getAzureVoices();
        case TTSProvider.Local:
            return getLocalVoices();
        default:
            return [];
    }
}

export function getTTSProviders() {
    return [TTSProvider.Browser, TTSProvider.Azure, TTSProvider.Local];
}

export function getTTS(provider?: string, voiceName?: string): TTS | undefined {
    switch (provider) {
        case TTSProvider.Browser:
            return getBrowserTTSProvider(voiceName);
        case TTSProvider.Local:
            return getLocalTTSProvider(voiceName);
        case TTSProvider.Azure:
        case undefined: // default to Azure
            return getAzureTTSProvider(voiceName);

        default:
            return undefined;
    }
}
