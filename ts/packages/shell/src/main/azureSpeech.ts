// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { Result } from "typechat";
import { AzureTokenScopes, createAzureTokenProvider } from "aiclient";

export interface TokenResponse {
    token: string;
    region: string;
    endpoint: string;
}

const defaultVoiceName = "en-US-RogerNeural";
const defaultVoiceStyle = "chat";
const IdentityApiKey = "identity";
const azureTokenProvider = createAzureTokenProvider(
    AzureTokenScopes.CogServices,
);

export class AzureSpeech {
    private static instance: AzureSpeech;
    private token: string = "";

    private constructor(
        private readonly subscriptionKey: string,
        private readonly region: string,
        private readonly endpoint: string,
    ) {
        // ...
    }

    public static initialize = (config: {
        azureSpeechSubscriptionKey: string;
        azureSpeechRegion: string;
        azureSpeechEndpoint: string;
    }): void => {
        if (AzureSpeech.instance) {
            return;
        }
        const {
            azureSpeechSubscriptionKey,
            azureSpeechRegion,
            azureSpeechEndpoint,
        } = config;
        AzureSpeech.instance = new AzureSpeech(
            azureSpeechSubscriptionKey,
            azureSpeechRegion,
            azureSpeechEndpoint,
        );
    };

    public static getInstance = (): AzureSpeech => {
        return AzureSpeech.instance;
    };

    public getTokenAsync = async (): Promise<TokenResponse> => {
        let result: TokenResponse;

        if (
            this.subscriptionKey.toLowerCase() == IdentityApiKey.toLowerCase()
        ) {
            result = await this.getIdentityBasedTokenAsync();
        } else {
            result = await this.getKeyBasedTokenAsync();
        }

        this.token = result.token;

        return result;
    };

    private getIdentityBasedTokenAsync = async (): Promise<TokenResponse> => {
        const tokenResult: Result<string> =
            await azureTokenProvider.getAccessToken();

        if (!tokenResult.success) {
            throw new Error(
                `Failed to get identity based token.\nMake sure you have logged in using 'az login' if you are using AzCLI for auth.\n\n${tokenResult.message}`,
            );
        }

        const result: TokenResponse = {
            token: tokenResult.data,
            region: this.region,
            endpoint: this.endpoint,
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

        const tokenEndpoint = `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;
        const response = await fetch(tokenEndpoint, options);
        if (!response.ok) {
            throw new Error(
                `AzureSpeech: Failed to get key based token! ${response.status} ${response.statusText}`,
            );
        }

        const result: TokenResponse = {
            token: await response.text(),
            region: this.region,
            endpoint: this.endpoint,
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

        if (
            this.subscriptionKey.toLowerCase() == IdentityApiKey.toLowerCase()
        ) {
            speechConfig = sdk.SpeechConfig.fromAuthorizationToken(
                `aad#${this.endpoint}#${this.token}`,
                this.region,
            );
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
