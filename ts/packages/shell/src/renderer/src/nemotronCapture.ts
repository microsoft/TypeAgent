// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ClientAPI } from "../../preload/electronTypes.js";

type AudioFrame =
    | { type: "audio"; pcm: Uint8Array; rms: number }
    | { type: "flushed" };

export class NemotronCapture {
    private sessionId?: string;
    private stream?: MediaStream;
    private context?: AudioContext;
    private node?: AudioWorkletNode;
    private unsubscribe?: () => void;
    private pending = Promise.resolve();
    private queued = 0;
    private quietSamples = 0;
    private ending = false;
    private terminal = false;
    private flushed?: () => void;

    constructor(
        private readonly api: Pick<
            ClientAPI,
            | "startLocalAsr"
            | "appendLocalAsr"
            | "endLocalAsr"
            | "onLocalAsrEvent"
        >,
        private readonly callbacks: {
            result: (text: string, final: boolean) => void;
            listening: () => void;
            finalizing: () => void;
            error: (error: Error) => void;
        },
    ) {}

    async start() {
        this.unsubscribe = this.api.onLocalAsrEvent((event) => {
            if (event.sessionId !== this.sessionId || this.terminal) return;
            if (event.type === "error") this.fail(new Error(event.message));
            else {
                this.callbacks.result(event.text, event.final);
                if (event.final) {
                    this.terminal = true;
                    this.cleanup();
                }
            }
        });
        this.sessionId = await this.api.startLocalAsr();
        if (this.terminal) {
            await this.api.endLocalAsr(this.sessionId, true);
            return;
        }
        const selector = document.getElementById("microphoneSources");
        const device =
            selector instanceof HTMLSelectElement ? selector.value : undefined;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio:
                device && device !== "<default>"
                    ? { deviceId: { exact: device } }
                    : true,
        });
        this.stream = stream;
        if (this.terminal) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        // Chromium performs capture-rate conversion into this context; reject rather
        // than mislabel audio if a host does not honor the requested processing rate.
        const context = new AudioContext({ sampleRate: 16000 });
        this.context = context;
        if (context.sampleRate !== 16000)
            throw new Error(
                "This device does not support a 16 kHz audio context.",
            );
        await context.audioWorklet.addModule(
            new URL("./pcmCaptureWorklet.js", import.meta.url).href,
        );
        if (this.terminal) return;
        const node = new AudioWorkletNode(context, "typeagent-pcm-capture");
        this.node = node;
        node.port.onmessage = ({ data }: MessageEvent<AudioFrame>) => {
            if (data.type === "flushed") {
                this.flushed?.();
                return;
            }
            if (this.terminal) return;
            if (++this.queued > 20) {
                this.fail(
                    new Error(
                        "Local speech cannot keep up with microphone capture.",
                    ),
                );
                return;
            }
            this.pending = this.pending
                .then(async () => {
                    if (!this.terminal && this.sessionId) {
                        await this.api.appendLocalAsr(this.sessionId, data.pcm);
                    }
                })
                .catch((error: unknown) => {
                    this.fail(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    );
                })
                .finally(() => this.queued--);
            this.quietSamples =
                data.rms < 0.0031623
                    ? this.quietSamples + data.pcm.byteLength / 2
                    : 0;
            if (this.quietSamples >= 16000) {
                void this.finish().catch((error: unknown) =>
                    this.fail(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    ),
                );
            }
        };
        node.onprocessorerror = () =>
            this.fail(new Error("Microphone audio processing failed."));
        context.createMediaStreamSource(stream).connect(node);
        node.connect(context.destination);
        await context.resume();
        if (!this.terminal && !this.ending) this.callbacks.listening();
    }

    async finish() {
        if (this.terminal || this.ending) return;
        if (!this.node) {
            this.cancel();
            return;
        }
        this.ending = true;
        this.callbacks.finalizing();
        await new Promise<void>((resolve) => {
            this.flushed = resolve;
            this.node!.port.postMessage("finish");
        });
        this.closeCapture();
        await this.pending;
        if (!this.terminal && this.sessionId) {
            await this.api.endLocalAsr(this.sessionId, false);
        }
    }

    cancel() {
        if (this.terminal) return;
        this.terminal = true;
        this.cleanup();
        if (this.sessionId) {
            void this.api
                .endLocalAsr(this.sessionId, true)
                .catch((error: unknown) =>
                    this.callbacks.error(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    ),
                );
        }
    }

    private fail(error: Error) {
        if (this.terminal) return;
        this.cancel();
        this.callbacks.error(error);
    }

    private closeCapture() {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = undefined;
        this.node?.disconnect();
        this.node?.port.close();
        this.node = undefined;
        if (this.context && this.context.state !== "closed") {
            void this.context
                .close()
                .catch((error: unknown) =>
                    this.callbacks.error(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    ),
                );
        }
        this.context = undefined;
    }

    private cleanup() {
        this.flushed?.();
        this.flushed = undefined;
        this.closeCapture();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }
}
