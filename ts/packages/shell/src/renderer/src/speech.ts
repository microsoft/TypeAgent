// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import { SpeechToken } from "./speechToken";
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
    ) as HTMLSelectElement | null;

    if (microphoneSources?.value && microphoneSources.value !== "<default>") {
        debug(`Using device id: ${microphoneSources.value}`);
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
    return !useLocalWhisper;
}
export function recognizeOnce(
    token: SpeechToken | undefined,
    onRecognizing: (text: string) => void,
    onRecognized: (text: string) => void,
    onError: (error: string) => void,
    useLocalWhisper?: boolean,
): () => void {
    if (useLocalWhisper) {
        const reco = new WhisperRecognizer();
        reco.onError((error) => onError(`[ERROR: ${error.message}]`));

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
            reco.dispose();
        });

        reco.initialize()
            .then(() => {
                reco.startRecording();
            })
            .catch((error: unknown) => {
                reco.dispose();
                onError(error instanceof Error ? error.message : String(error));
            });
        return () => reco.dispose();
    } else {
        let cancel = () => {};
        try {
            const audioConfig = getAudioConfig();
            const speechConfig = getSpeechConfig(token);
            if (!speechConfig) {
                audioConfig.close();
                throw new Error("Azure Speech authorization is unavailable.");
            }
            const reco = new speechSDK.SpeechRecognizer(
                speechConfig,
                audioConfig,
            );
            let canceled = false;
            cancel = () => {
                if (canceled) return;
                canceled = true;
                reco.close();
                audioConfig.close();
            };
            reco.recognizing = (_s, e) => {
                if (!canceled) onRecognizing(e.result.text);
            };
            reco.recognizeOnceAsync(
                (result) => {
                    if (!canceled)
                        onRecognizedResult(result, onRecognized, onError);
                    cancel();
                },
                (err) => {
                    debugError(err);
                    if (!canceled) onError(`[ERROR: ${err}]`);
                    cancel();
                },
            );
        } catch (e: any) {
            debugError("Speech recognition setup failed", e);
            onError(`[ERROR: ${e.message}]`);
        }
        return cancel;
    }
}

export class ContinousSpeechRecognizer {
    private whisperRecognizer: WhisperRecognizer | undefined;
    private reco: speechSDK.SpeechRecognizer | undefined;
    private audioConfig: speechSDK.AudioConfig | undefined;
    private speechConfig: speechSDK.SpeechConfig | undefined;
    private token: SpeechToken | undefined;
    private onRecognizing: (text: string) => void;
    private onRecognized: (text: string) => void;
    private onError: (error: string) => void;
    private started: boolean = false;
    private ready = Promise.resolve();

    constructor(
        useWhisper: boolean = false,
        token: SpeechToken | undefined = undefined,
        onRecognizing: (text: string) => void,
        onRecognized: (text: string) => void,
        onError: (error: string) => void,
    ) {
        this.onRecognizing = onRecognizing;
        this.onRecognized = onRecognized;
        this.onError = onError;

        if (useWhisper) {
            this.whisperRecognizer = new WhisperRecognizer();
            this.whisperRecognizer.onError((error) =>
                this.onError(`[ERROR: ${error.message}]`),
            );

            this.whisperRecognizer.onRecognizing((data) => {
                this.onRecognizing(data.text);
            });

            this.whisperRecognizer.onRecognized((data) => {
                const result = new speechSDK.SpeechRecognitionResult(
                    undefined,
                    speechSDK.ResultReason.RecognizedSpeech,
                    data.text,
                );
                onRecognizedResult(result, this.onRecognized, this.onError);
            });

            this.ready = this.whisperRecognizer.initialize();
        } else {
            this.token = token;
            this.audioConfig = getAudioConfig();
            this.speechConfig = getSpeechConfig(this.token);
            this.reco = new speechSDK.SpeechRecognizer(
                this.speechConfig!,
                this.audioConfig!,
            );
            // The 'recognizing' event signals that an intermediate recognition result is received.
            // Intermediate results arrive while audio is being processed and represent the current "best guess" about
            // what's been spoken so far.
            this.reco.recognizing = (_s, e) => {
                this.onRecognizing(e.result.text);
            };
            this.reco.recognized = (_s, e) => {
                onRecognizedResult(e.result, this.onRecognized, this.onError);
            };
        }
    }

    public start() {
        // don't do anything if already started
        if (this.started) return;

        this.started = true;

        if (this.whisperRecognizer) {
            void this.ready
                .then(() => {
                    if (this.started) this.whisperRecognizer?.startRecording();
                })
                .catch((error: unknown) =>
                    this.onError(
                        error instanceof Error ? error.message : String(error),
                    ),
                );
        } else {
            console.log("[voice] startContinuousRecognitionAsync called");
            this.reco!.startContinuousRecognitionAsync(
                () => {
                    console.log("[voice] continuous recognition started OK");
                },
                (error) => {
                    this.onError(error);
                },
            );
        }
    }

    public stop() {
        this.started = false;
        this.whisperRecognizer?.dispose();
        const reco = this.reco;
        this.reco = undefined;
        if (reco) {
            reco.stopContinuousRecognitionAsync(
                () => {
                    reco.close();
                    this.audioConfig?.close();
                },
                (error) => {
                    reco.close();
                    this.audioConfig?.close();
                    this.onError(error);
                },
            );
        }
    }
}
