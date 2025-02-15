// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { SpeechToken } from "../../preload/electronTypes.js";
import { WhisperRecognizer } from "./localWhisperClient";
import registerDebug from "debug";

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
    button.children[0].classList.remove("chat-message-hidden");
    button.children[1].classList.add("chat-message-hidden");

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
    button.children[0].classList.add("chat-message-hidden");
    button.children[1].classList.remove("chat-message-hidden");

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
    } else if (
        typeof Android !== "undefined" &&
        Android?.isSpeechRecognitionSupported()
    ) {
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

            onRecognizedResult(result, inputId, buttonId, messageHandler);
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
