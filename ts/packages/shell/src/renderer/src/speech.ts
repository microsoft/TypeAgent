// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { SpeechToken } from "../../preload/electronTypes.js";
import { WhisperRecognizer } from "./localWhisperClient";
import registerDebug from "debug";
import { getAndroidAPI } from "./main.js";

const debug = registerDebug("typeagent:shell:speech");
const debugError = registerDebug("typeagent:shell:speech:error");

export async function enumerateMicrophones() {
    // Not all environments will be able to enumerate mic labels and ids. All environments will be able
    // to select a default input, assuming appropriate permissions.
    const deviceIds = new Set<string>();
    const result: [string, string][] = [];
    const devices = await navigator?.mediaDevices?.enumerateDevices?.();
    if (devices === undefined) {
        debugError(
            `Unable to query for audio input devices. Default will be used.\r\n`,
        );
        return [];
    }
    for (const device of devices) {
        debug(device);
        if (device.kind === "audioinput") {
            if (!device.deviceId) {
                debugError(
                    `Warning: unable to enumerate a microphone deviceId. This may be due to limitations` +
                        ` with availability in a non-HTTPS context per mediaDevices constraints.`,
                );
            } else {
                if (!deviceIds.has(device.deviceId)) {
                    result.push([device.label, device.deviceId]);
                    deviceIds.add(device.deviceId);
                }
            }
        }
    }
    return result;
}

export function getAudioConfig() {
    const microphoneSources = document.getElementById(
        "microphoneSources",
    )! as HTMLSelectElement;

    if (microphoneSources.value) {
        const deviceId =
            microphoneSources.value === "<default>"
                ? undefined
                : microphoneSources.value;
        debug(`Using device id: ${deviceId}`);
        return speechSDK.AudioConfig.fromMicrophoneInput(deviceId);
    }
    return speechSDK.AudioConfig.fromDefaultMicrophoneInput();
}

export function getSpeechConfig(token: SpeechToken | undefined) {
    let speechConfig: speechSDK.SpeechConfig;
    if (token) {
        speechConfig = speechSDK.SpeechConfig.fromAuthorizationToken(
            `aad#${token.endpoint}#${token.token}`,
            token.region,
        );
    } else {
        return undefined;
    }
    speechConfig.speechRecognitionLanguage = "en-US";
    return speechConfig;
}

function onRecognizedResult(
    result: speechSDK.SpeechRecognitionResult,
    onRecognized: (text: string) => void,
    onError: (error: string) => void,
) {
    switch (result.reason) {
        case speechSDK.ResultReason.RecognizedSpeech:
            onRecognized(result.text);
            break;
        case speechSDK.ResultReason.NoMatch:
            onError("[Speech could not be recognized]");
            break;
        case speechSDK.ResultReason.Canceled:
            const cancellationResult =
                speechSDK.CancellationDetails.fromResult(result);
            if (
                cancellationResult.reason === speechSDK.CancellationReason.Error
            ) {
                onError(
                    `[ERROR: ${cancellationResult.errorDetails} (code:${cancellationResult.ErrorCode})]`,
                );

                if (cancellationResult.ErrorCode == 4) {
                    onError(`Did you forget to elevate your RBAC role?`);
                }
                break;
            }
            onError(`[ERROR: Cancelled]`);
            break;
        default:
            onError(`[Unknown reason ${result.reason}]`);
            break;
    }
}

export function needSpeechToken(useLocalWhisper: boolean) {
    return (
        !useLocalWhisper &&
        getAndroidAPI()?.isSpeechRecognitionSupported() !== true
    );
}
export function recognizeOnce(
    token: SpeechToken | undefined,
    onRecognizing: (text: string) => void,
    onRecognized: (text: string) => void,
    onError: (error: string) => void,
    useLocalWhisper?: boolean,
) {
    if (useLocalWhisper) {
        const reco = new WhisperRecognizer();

        reco.onRecognizing((data) => {
            onRecognizing(data.text);
        });

        reco.onRecognized((data) => {
            const result = new speechSDK.SpeechRecognitionResult(
                undefined,
                speechSDK.ResultReason.RecognizedSpeech,
                data.text,
            );
            onRecognizedResult(result, onRecognized, onError);
        });

        reco.initialize().then(() => {
            reco.startRecording();
        });
    } else if (getAndroidAPI()?.isSpeechRecognitionSupported() === true) {
        // use built-in device speech recognition
        Bridge.interfaces.Android.recognize((text: string | undefined) => {
            let result: speechSDK.SpeechRecognitionResult | undefined;

            if (text === undefined || text === null) {
                result = new speechSDK.SpeechRecognitionResult(
                    undefined,
                    speechSDK.ResultReason.NoMatch,
                    text,
                );
            } else {
                result = new speechSDK.SpeechRecognitionResult(
                    undefined,
                    speechSDK.ResultReason.RecognizedSpeech,
                    text,
                );
            }

            onRecognizedResult(result, onRecognized, onError);
        });
    } else {
        const audioConfig = getAudioConfig();
        const speechConfig = getSpeechConfig(token);
        const reco = new speechSDK.SpeechRecognizer(speechConfig!, audioConfig);
        // The 'recognizing' event signals that an intermediate recognition result is received.
        // Intermediate results arrive while audio is being processed and represent the current "best guess" about
        // what's been spoken so far.
        reco.recognizing = (_s, e) => {
            onRecognizing(e.result.text);
        };
        // Note: this scenario sample demonstrates result handling via continuation on the recognizeOnceAsync call.
        // The 'recognized' event handler can be used in a similar fashion.
        reco.recognizeOnceAsync(
            (result) => {
                onRecognizedResult(result, onRecognized, onError);
            },
            (err) => {
                debugError(err);
                onError(`[ERROR: ${err}]`);
            },
        );
    }
}
