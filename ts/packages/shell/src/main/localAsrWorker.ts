// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AudioSession,
    FoundryLocalManager,
    Item,
    ItemQueue,
    Request,
    type IModel,
} from "foundry-local-sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
    LocalAsrRequest,
    LocalAsrWorkerEvent,
} from "../preload/localAsrTypes.js";
import { LocalAsrTranscript } from "./localAsrTranscript.js";

const modelAlias = "nemotron-3.5-asr-streaming-0.6b";
const port = process.parentPort;
if (!port)
    throw new Error("Local ASR must run in an isolated utility process.");
const emit = (event: LocalAsrWorkerEvent) => port.postMessage(event);
let manager: FoundryLocalManager | undefined;
let model: IModel | undefined;
let setup: AbortController | undefined;

type Recognition = {
    id: string;
    queue: ItemQueue;
    session: AudioSession;
    abort: AbortController;
    done: Promise<void>;
    error?: Error;
    finished: boolean;
};
let active: Recognition | undefined;

async function prepare(cacheDir: string, allowDownload: boolean) {
    if (setup) throw new Error("Local speech setup is already in progress.");
    const abort = new AbortController();
    setup = abort;
    try {
        emit({
            type: "progress",
            message: "Loading the local speech runtime...",
        });
        if (!manager) {
            const root = path
                .dirname(
                    path.dirname(
                        fileURLToPath(import.meta.resolve("foundry-local-sdk")),
                    ),
                )
                .replace(/\.asar([\\/])/, ".asar.unpacked$1");
            manager = FoundryLocalManager.create({
                appName: "typeagent-shell",
                appDataDir: cacheDir,
                modelCacheDir: path.join(cacheDir, "models"),
                logsDir: path.join(cacheDir, "logs"),
                disableNonessentialTelemetry: true,
                libraryPath: path.join(
                    root,
                    "prebuilds",
                    `${process.platform}-${process.arch}`,
                ),
                additionalSettings: { AzureCatalogFilter: "'',test" },
            });
        }
        model ??= await manager.catalog.getModel(modelAlias);
        if (!model.isCached) {
            if (!allowDownload) {
                throw new Error(
                    "Nemotron is not cached. Run @shell speechProvider nemotron to download it.",
                );
            }
            emit({ type: "progress", message: `Downloading ${modelAlias}...` });
            await model.download((percent) => {
                emit({
                    type: "progress",
                    message: `Downloading ${modelAlias}...`,
                    percent,
                });
            }, abort.signal);
        }
        abort.signal.throwIfAborted();
        emit({
            type: "progress",
            message: "Loading the Nemotron speech model...",
        });
        if (!(await model.isLoaded())) await model.load();
        abort.signal.throwIfAborted();
        emit({ type: "progress", message: "Nemotron speech is ready." });
    } finally {
        setup = undefined;
    }
}

function start(id: string) {
    if (active) throw new Error("A local speech session is already active.");
    if (!model) throw new Error("The Nemotron speech model is not ready.");
    const session = new AudioSession(model);
    const queue = new ItemQueue();
    const request = new Request()
        .addItem(Item.audioDescriptor("pcm", 16000, 1))
        .addItem(queue);
    const recognition: Recognition = {
        id,
        session,
        queue,
        abort: new AbortController(),
        done: Promise.resolve(),
        finished: false,
    };
    active = recognition;
    recognition.done = transcribe(recognition, request);
}

async function transcribe(recognition: Recognition, request: Request) {
    try {
        const transcript = new LocalAsrTranscript();
        const stream = recognition.session.processStreamingRequest(request, {
            signal: recognition.abort.signal,
        });
        const [, response] = await Promise.all([
            (async () => {
                for await (const item of stream) {
                    if (
                        item.type === "speechSegment" &&
                        !recognition.abort.signal.aborted
                    ) {
                        emit({
                            type: "result",
                            sessionId: recognition.id,
                            final: false,
                            text: transcript.update(item.text, item.kind),
                        });
                    }
                }
            })(),
            stream.response,
        ]);
        if (!recognition.abort.signal.aborted) {
            if (response.finishReason === "error")
                throw new Error("Nemotron transcription failed.");
            const aggregate = response.output.find(
                (item): item is Extract<Item, { type: "speechResult" }> =>
                    item.type === "speechResult",
            );
            const text =
                aggregate?.text ??
                response.output
                    .flatMap((item) =>
                        item.type === "text" ? [item.text] : [],
                    )
                    .join("");
            emit({
                type: "result",
                sessionId: recognition.id,
                text: text.trim(),
                final: true,
            });
        }
    } catch (error) {
        if (!recognition.abort.signal.aborted) {
            recognition.error =
                error instanceof Error ? error : new Error(String(error));
            emit({
                type: "error",
                sessionId: recognition.id,
                message: recognition.error.message,
            });
        }
    } finally {
        recognition.queue.dispose();
        recognition.session.dispose();
        if (active === recognition) active = undefined;
    }
}

async function handle(request: LocalAsrRequest) {
    switch (request.type) {
        case "prepare":
            return prepare(request.cacheDir, request.allowDownload);
        case "cancelSetup":
            setup?.abort();
            return;
        case "start":
            return start(request.sessionId);
        case "append": {
            const recognition = active;
            if (
                !recognition ||
                recognition.id !== request.sessionId ||
                recognition.finished
            ) {
                throw new Error("The local speech session is not recording.");
            }
            if (
                !(request.pcm instanceof Uint8Array) ||
                request.pcm.byteLength === 0 ||
                request.pcm.byteLength > 3200 ||
                request.pcm.byteLength % 2 !== 0
            ) {
                throw new Error(
                    "Expected at most 100 ms of mono 16 kHz PCM16 audio.",
                );
            }
            // More than two seconds queued means this device cannot sustain live capture.
            if (recognition.queue.size >= 20) {
                throw new Error(
                    "Local speech cannot keep up with capture on this device. Stop and try a supported faster device.",
                );
            }
            recognition.queue.push(Item.bytes(request.pcm));
            return;
        }
        case "finish":
        case "cancel": {
            const recognition = active;
            if (!recognition || recognition.id !== request.sessionId) return;
            recognition.finished = true;
            if (request.type === "cancel") recognition.abort.abort();
            else recognition.queue.markFinished();
            await recognition.done;
            if (recognition.error) throw recognition.error;
        }
    }
}

port.on("message", ({ data }: { data: LocalAsrRequest }) => {
    void handle(data).then(
        () => emit({ type: "reply", requestId: data.requestId }),
        (error: unknown) =>
            emit({
                type: "reply",
                requestId: data.requestId,
                error: error instanceof Error ? error.message : String(error),
            }),
    );
});
