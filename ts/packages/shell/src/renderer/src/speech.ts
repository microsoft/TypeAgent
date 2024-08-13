// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { SpeechToken } from "../../preload/electronTypes";
import { WhisperRecognizer } from "./localWhisperClient";

export function enumerateMicrophones(microphoneSources: HTMLSelectElement) {
    if (
        !navigator ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.enumerateDevices
    ) {
        console.log(
            `Unable to query for audio input devices. Default will be used.\r\n`,
        );
        return;
    }

    navigator.mediaDevices.enumerateDevices().then((devices) => {
        microphoneSources.innerHTML = "";

        // Not all environments will be able to enumerate mic labels and ids. All environments will be able
        // to select a default input, assuming appropriate permissions.
        var defaultOption = document.createElement("option");
        defaultOption.appendChild(
            document.createTextNode("Default Microphone"),
        );
        microphoneSources.appendChild(defaultOption);
        const deviceIds = new Set<string>();
        for (const device of devices) {
            if (device.kind === "audioinput") {
                if (!device.deviceId) {
                    window.console.log(
                        `Warning: unable to enumerate a microphone deviceId. This may be due to limitations` +
                            ` with availability in a non-HTTPS context per mediaDevices constraints.`,
                    );
                } else {
                    if (!deviceIds.has(device.deviceId)) {
                        var opt = document.createElement("option");
                        opt.value = device.deviceId;
                        console.log(`Device ID: ${device.label}`);
                        opt.appendChild(document.createTextNode(device.label));

                        microphoneSources.appendChild(opt);
                        deviceIds.add(device.deviceId);
                    }
                }
            }
        }

        microphoneSources.disabled = microphoneSources.options.length == 1;
    });
}

export class SpeechInfo {
    public speechToken?: SpeechToken | undefined = undefined;
}

export function getAudioConfig() {
    const microphoneSources = document.getElementById(
        "microphoneSources",
    )! as HTMLSelectElement;

    if (microphoneSources.value) {
        console.log(`Using device id: ${microphoneSources.value}`);
        return speechSDK.AudioConfig.fromMicrophoneInput(
            microphoneSources.value,
        );
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

function onRecognizing(
    recognitionEventArgs: speechSDK.SpeechRecognitionEventArgs,
    inputId: string,
) {
    console.log("Running Recognizing step");
    const result = recognitionEventArgs.result;
    const phraseDiv = document.querySelector<HTMLDivElement>(`#${inputId}`)!;
    // Update the hypothesis line in the phrase/result view (only have one)
    phraseDiv.innerHTML =
        phraseDiv.innerHTML.replace(
            /(.*)(^|[\r\n]+).*\[\.\.\.\][\r\n]+/,
            "$1$2",
        ) + `${result.text} [...]\r\n`;
    phraseDiv.scrollTop = phraseDiv.scrollHeight;
}

function onRecognizedResult(
    result: speechSDK.SpeechRecognitionResult,
    inputId: string,
    buttonId: string,
    messageHandler: (message: string) => void,
) {
    const button = document.querySelector<HTMLButtonElement>(`#${buttonId}`)!;
    button.disabled = false;
    const phraseDiv = document.querySelector<HTMLDivElement>(`#${inputId}`)!;
    let message: string;
    let errorMessage: string | undefined = undefined;
    if (result.reason === speechSDK.ResultReason.RecognizedSpeech) {
        message = result.text;
        messageHandler(message);
        phraseDiv.innerHTML = message;
        phraseDiv.scrollTop = phraseDiv.scrollHeight;
    } else if (result.reason == speechSDK.ResultReason.NoMatch) {
        errorMessage = "[Speech could not be recognized]";
    } else if (result.reason == speechSDK.ResultReason.Canceled) {
        const cancelationResult =
            speechSDK.CancellationDetails.fromResult(result);
        if (cancelationResult.reason == speechSDK.CancellationReason.Error) {
            errorMessage = `[ERROR: ${cancelationResult.errorDetails} (code:${cancelationResult.ErrorCode})]`;

            if (cancelationResult.ErrorCode == 4) {
                errorMessage += `Did you forget to elevate your RBAC role?`;
            }
        } else {
            errorMessage = `[ERROR: Cancelled]`;
        }
    } else {
        errorMessage = `[Unknown reason ${result.reason}]`;
    }
    if (errorMessage !== undefined) {
        console.log(errorMessage);
    }
    phraseDiv.innerHTML = "";
    phraseDiv.scrollTop = phraseDiv.scrollHeight;
}

export function recognizeOnce(
    token: SpeechToken | undefined,
    inputId: string,
    buttonId: string,
    messageHandler: (message: string) => void,
    useLocalWhisper?: boolean,
) {
    const button = document.querySelector<HTMLButtonElement>(`#${buttonId}`)!;
    const phraseDiv = document.querySelector<HTMLDivElement>(`#${inputId}`)!;
    if (button.disabled) {
        return;
    }
    phraseDiv.innerHTML = "";
    button.disabled = true;
    if (useLocalWhisper) {
        const reco = new WhisperRecognizer();

        reco.onRecognizing((data) => {
            const result = new speechSDK.SpeechRecognitionResult(
                undefined,
                speechSDK.ResultReason.RecognizedSpeech,
                data.text,
            );
            const e = new speechSDK.SpeechRecognitionEventArgs(result);
            onRecognizing(e, inputId);
        });

        reco.onRecognized((data) => {
            const result = new speechSDK.SpeechRecognitionResult(
                undefined,
                speechSDK.ResultReason.RecognizedSpeech,
                data.text,
            );
            onRecognizedResult(result, inputId, buttonId, messageHandler);
        });

        reco.initialize().then(() => {
            reco.startRecording();
        });
    } else {
        const audioConfig = getAudioConfig();
        const speechConfig = getSpeechConfig(token);
        const reco = new speechSDK.SpeechRecognizer(speechConfig!, audioConfig);
        // The 'recognizing' event signals that an intermediate recognition result is received.
        // Intermediate results arrive while audio is being processed and represent the current "best guess" about
        // what's been spoken so far.
        reco.recognizing = (_s, e) => {
            onRecognizing(e, inputId);
        };
        // Note: this scenario sample demonstrates result handling via continuation on the recognizeOnceAsync call.
        // The 'recognized' event handler can be used in a similar fashion.
        reco.recognizeOnceAsync(
            (result) => {
                onRecognizedResult(result, inputId, buttonId, messageHandler);
            },
            function (err) {
                window.console.log(err);
                phraseDiv.innerHTML += "ERROR: " + err;
            },
        );
    }
}
