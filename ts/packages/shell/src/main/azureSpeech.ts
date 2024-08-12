// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { Result } from "typechat";
import {
    AzureTokenScopes,
    createAzureTokenProvider,
} from "aiclient";

export interface TokenResponse {
    token: string;
    region: string;
}

const defaultVoiceName = "en-US-RogerNeural";
const defaultVoiceStyle = "chat";
const IdentityApiKey = "identity";
const azureTokenProvider = createAzureTokenProvider(
    AzureTokenScopes.CogServices,
);

export class AzureSpeech {
    private static instance: AzureSpeech;
    private token: string;

    private constructor(
        private readonly subscriptionKey: string,
        private readonly region: string,
    ) {
        // ...
    }

    public static initializeAsync = async (config: {
        azureSpeechSubscriptionKey: string;
        azureSpeechRegion: string;
    }): Promise<void> => {
        if (AzureSpeech.instance) {
            return;
        }
        const { azureSpeechSubscriptionKey, azureSpeechRegion } = config;
        AzureSpeech.instance = new AzureSpeech(
            azureSpeechSubscriptionKey,
            azureSpeechRegion,
        );
    };

    public static getInstance = (): AzureSpeech => {
        if (!AzureSpeech.instance) {
            throw new Error("AzureSpeech: not initialized");
        }
        return AzureSpeech.instance;
    };

    public getTokenAsync = async (): Promise<TokenResponse> => {
        let result: TokenResponse;

        if (this.subscriptionKey.toLowerCase() == IdentityApiKey.toLowerCase()) {
            result = await this.getIdentityBasedTokenAsync();
        } else {
            result = await this.getKeyBasedTokenAsync();
        }

        this.token = result.token;

        return result;
    };

    private getIdentityBasedTokenAsync = async (): Promise<TokenResponse> => {
        
        const tokenResult: Result<string> = await azureTokenProvider.getAccessToken();

        if (!tokenResult.success) {
            throw new Error(
                `AzureSpeech: getIdentityBasedTokenAsync: Failed to get identity based token! tokenResule: ${tokenResult}`,
            );
        }

        const result: TokenResponse = {
            token: tokenResult.data,
            region: this.region,
        };

        return result;    
    };

    private getKeyBasedTokenAsync = async (): Promise<TokenResponse> => {
        const options: RequestInit = {
            method: "POST",
            headers: new Headers({
                "Content-Type": "application/x-www-form-urlencoded",
                "Ocp-Apim-Subscription-Key": this.subscriptionKey,
            }),
        };

        const endpoint = `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            throw new Error(
                `AzureSpeech: getTokenAsync: ${response.status} ${response.statusText}`,
            );
        }

        const result: TokenResponse = {
            token: await response.text(),
            region: this.region,
        };

        return result;
    };

    public getTextToSpeechAsync = async (
        text: string,
        voiceName?: string,
        voiceStyle?: string,
    ) => {
        let speechConfig = sdk.SpeechConfig.fromSubscription(
            this.subscriptionKey,
            this.region,
        );

        if (this.subscriptionKey.toLowerCase() == IdentityApiKey.toLowerCase()) {
            speechConfig = sdk.SpeechConfig.fromAuthorizationToken(this.token, this.region)
        }

        const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

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

        return await new Promise<string>((resolve, reject) => {
            synthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    const { audioData } = result;
                    synthesizer.close();

                    const buffer = Buffer.from(audioData);
                    resolve(buffer.toString("base64"));
                },
                (error) => {
                    synthesizer.close();
                    reject(error);
                },
            );
        });
    };
}
