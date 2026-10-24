// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import vm from "node:vm";
import { LocalAsrTranscript } from "../../src/main/localAsrTranscript.js";
import { NemotronCapture } from "../../src/renderer/src/nemotronCapture.js";
import type { LocalAsrEvent } from "../../src/preload/localAsrTypes.js";

test("partial hypotheses replace the current segment and finals commit it once", () => {
    const transcript = new LocalAsrTranscript();
    assert.equal(transcript.update("turn", "partial"), "turn");
    assert.equal(transcript.update("turn on", "partial"), "turn on");
    assert.equal(
        transcript.update("turn on the lights", "final"),
        "turn on the lights",
    );
    assert.equal(transcript.update("in", "partial"), "turn on the lights in");
    assert.equal(
        transcript.update("in the kitchen", "final"),
        "turn on the lights in the kitchen",
    );
});

test("SDK none-kind token fragments form a cumulative textbox hypothesis", () => {
    const transcript = new LocalAsrTranscript();
    const fragments = [
        " T",
        "ur",
        "n",
        " ",
        "on",
        " the",
        " ",
        "l",
        "ight",
        "s",
    ];
    const hypotheses = fragments.map((text) => transcript.update(text, "none"));
    assert.equal(hypotheses[2], "Turn");
    assert.equal(hypotheses.at(-1), "Turn on the lights");
});

test("the worklet downmixes, clips PCM16 little endian, and flushes trailing samples", () => {
    const messages: { type: string; pcm?: Uint8Array; rms?: number }[] = [];
    let processor:
        | {
              process: (inputs: Float32Array[][]) => boolean;
              port: { onmessage: (event: { data: string }) => void };
          }
        | undefined;
    vm.runInNewContext(
        readFileSync(
            new URL(
                "../../src/renderer/src/pcmCaptureWorklet.js",
                import.meta.url,
            ),
            "utf8",
        ),
        {
            AudioWorkletProcessor: class {
                port = {
                    postMessage: (data: (typeof messages)[number]) =>
                        messages.push(data),
                };
            },
            registerProcessor: (
                _name: string,
                ctor: new () => NonNullable<typeof processor>,
            ) => {
                processor = new ctor();
            },
        },
    );
    assert.ok(processor);
    processor.process([
        [new Float32Array(1600).fill(2), new Float32Array(1600).fill(-2)],
    ]);
    assert.equal(messages[0].pcm?.length, 3200);
    assert.equal(messages[0].rms, 0);
    assert.ok(messages[0].pcm?.every((byte) => byte === 0));
    processor.process([[new Float32Array(1600).fill(2)]]);
    assert.deepEqual(Array.from(messages[1].pcm!.slice(0, 2)), [255, 127]);
    processor.process([[new Float32Array(64).fill(-2)]]);
    assert.equal(messages.length, 2);
    processor.port.onmessage({ data: "finish" });
    assert.equal(messages[2].pcm?.byteLength, 128);
    assert.deepEqual(Array.from(messages[2].pcm!.slice(0, 2)), [0, 128]);
    assert.equal(messages[3].type, "flushed");
    processor.process([[new Float32Array(1600).fill(1)]]);
    assert.equal(messages.length, 4);
});

function captureFixture(t: TestContext) {
    const calls: string[] = [];
    const results: [string, boolean][] = [];
    const errors: Error[] = [];
    let listener: ((event: LocalAsrEvent) => void) | undefined;
    let node: FakeNode | undefined;
    let stopped = 0;
    let closed = 0;
    let mediaReady: (() => void) | undefined;
    let resolveMedia: (() => void) | undefined;
    const mediaRequested = new Promise<void>(
        (resolve) => (mediaReady = resolve),
    );
    let blockMedia = false;
    const stream = { getTracks: () => [{ stop: () => stopped++ }] };
    class FakeContext {
        sampleRate = 16000;
        state = "suspended";
        audioWorklet = { addModule: async () => {} };
        createMediaStreamSource() {
            return { connect() {} };
        }
        async resume() {
            this.state = "running";
        }
        async close() {
            this.state = "closed";
            closed++;
        }
    }
    class FakeNode {
        constructor() {
            node = this;
        }
        port = {
            onmessage: (event: {
                data: { type: string; pcm?: Uint8Array; rms?: number };
            }) => {},
            postMessage: (message: string) => {
                assert.equal(message, "finish");
                calls.push("flush");
                this.send({ type: "audio", pcm: new Uint8Array(64), rms: 1 });
                this.send({ type: "flushed" });
            },
            close() {},
        };
        send(data: { type: string; pcm?: Uint8Array; rms?: number }) {
            this.port.onmessage({ data });
        }
        connect() {}
        disconnect() {}
    }
    const globals: Record<string, unknown> = {
        document: { getElementById: () => null },
        HTMLSelectElement: class {},
        AudioContext: FakeContext,
        AudioWorkletNode: FakeNode,
        navigator: {
            mediaDevices: {
                getUserMedia: async () => {
                    mediaReady?.();
                    if (blockMedia)
                        await new Promise<void>(
                            (resolve) => (resolveMedia = resolve),
                        );
                    return stream;
                },
            },
        },
    };
    for (const [name, value] of Object.entries(globals)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, value });
        t.after(() => {
            if (previous) Object.defineProperty(globalThis, name, previous);
            else Reflect.deleteProperty(globalThis, name);
        });
    }
    const capture = new NemotronCapture(
        {
            onLocalAsrEvent: (callback) => {
                listener = callback;
                return () => calls.push("unsubscribe");
            },
            startLocalAsr: async () => "owned-session",
            appendLocalAsr: async (_id, pcm) => {
                calls.push(`append:${pcm.length}`);
            },
            endLocalAsr: async (_id, cancel) => {
                calls.push(cancel ? "cancel" : "finish");
                if (!cancel)
                    listener?.({
                        type: "result",
                        sessionId: "owned-session",
                        text: "Canonical final.",
                        final: true,
                    });
            },
        },
        {
            result: (text, final) => results.push([text, final]),
            listening: () => calls.push("listening"),
            finalizing: () => calls.push("finalizing"),
            error: (error) => errors.push(error),
        },
    );
    t.after(() => capture.cancel());
    return {
        capture,
        calls,
        results,
        errors,
        node: () => node!,
        emit: (event: LocalAsrEvent) => listener?.(event),
        stopped: () => stopped,
        closed: () => closed,
        blockMedia: () => (blockMedia = true),
        mediaRequested,
        resolveMedia: () => resolveMedia?.(),
    };
}

test("capture streams live text, drains trailing audio before finish, and releases microphone", async (t) => {
    const f = captureFixture(t);
    await f.capture.start();
    assert.deepEqual(f.calls, ["listening"]);
    f.emit({
        type: "result",
        sessionId: "other-window",
        text: "Wrong owner",
        final: false,
    });
    f.emit({
        type: "result",
        sessionId: "owned-session",
        text: "Partial",
        final: false,
    });
    assert.deepEqual(f.results, [["Partial", false]]);
    f.node().send({ type: "audio", pcm: new Uint8Array(3200), rms: 1 });
    await f.capture.finish();
    assert.deepEqual(f.calls, [
        "listening",
        "finalizing",
        "flush",
        "append:3200",
        "append:64",
        "finish",
        "unsubscribe",
    ]);
    assert.deepEqual(f.results, [
        ["Partial", false],
        ["Canonical final.", true],
    ]);
    assert.equal(f.stopped(), 1);
    assert.equal(f.closed(), 1);
    assert.deepEqual(f.errors, []);
});

test("cancel during microphone permission acquisition releases the late stream", async (t) => {
    const f = captureFixture(t);
    f.blockMedia();
    const start = f.capture.start();
    await f.mediaRequested;
    f.capture.cancel();
    f.resolveMedia();
    await start;
    f.emit({
        type: "result",
        sessionId: "owned-session",
        text: "Late result",
        final: true,
    });
    assert.deepEqual(f.results, []);
    assert.equal(f.stopped(), 1);
    assert.ok(f.calls.includes("cancel"));
    assert.ok(!f.calls.includes("listening"));
});

test("inference errors cancel the session and surface without cloud fallback", async (t) => {
    const f = captureFixture(t);
    await f.capture.start();
    f.emit({
        type: "error",
        sessionId: "owned-session",
        message: "Native inference failed",
    });
    assert.equal(f.errors[0]?.message, "Native inference failed");
    assert.deepEqual(f.results, []);
    assert.equal(f.stopped(), 1);
    assert.ok(f.calls.includes("cancel"));
});

test("capture permits twenty pending frames and explicitly fails the twenty-first", async (t) => {
    const f = captureFixture(t);
    await f.capture.start();
    for (let index = 0; index < 20; index++) {
        f.node().send({ type: "audio", pcm: new Uint8Array(3200), rms: 1 });
    }
    assert.deepEqual(f.errors, []);
    f.node().send({ type: "audio", pcm: new Uint8Array(3200), rms: 1 });
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0].message, /cannot keep up/);
    assert.equal(f.stopped(), 1);
    assert.ok(f.calls.includes("cancel"));
});
