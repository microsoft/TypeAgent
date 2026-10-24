// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { createPromiseWithResolvers } from "@typeagent/common-utils";
import { WhisperRecognizer } from "../../src/renderer/src/localWhisperClient.js";

class MockMediaRecorder {
    state: RecordingState = "inactive";
    ondataavailable: ((event: { data: Blob }) => Promise<void>) | undefined;
    start = jest.fn(() => {
        this.state = "recording";
    });
    stop = jest.fn(() => {
        this.state = "inactive";
    });

    emitData(data = new Blob(["audio"])) {
        if (!this.ondataavailable) {
            throw new Error("The recorder has not been initialized.");
        }
        return this.ondataavailable({ data });
    }
}

const originalFetch = globalThis.fetch;
const originalGlobals = [
    "AudioContext",
    "MediaRecorder",
    "navigator",
    "requestAnimationFrame",
].map((name): [string, PropertyDescriptor | undefined] => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
]);

let recognizer: WhisperRecognizer;
let recorder: MockMediaRecorder;
let fetchMock: jest.MockedFunction<typeof fetch>;
let animationFrame: jest.MockedFunction<typeof requestAnimationFrame>;
let recognizing: jest.MockedFunction<(result: { text: string }) => void>;
let recognized: jest.MockedFunction<(result: { text: string }) => void>;
let onError: jest.MockedFunction<(error: Error) => void>;
let amplitude: number;

beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
    amplitude = 1;
    recorder = new MockMediaRecorder();
    fetchMock = jest.fn<typeof fetch>();
    animationFrame = jest.fn<typeof requestAnimationFrame>().mockReturnValue(1);
    globalThis.fetch = fetchMock;
    Object.defineProperties(globalThis, {
        AudioContext: {
            configurable: true,
            value: class {
                createMediaStreamSource() {
                    return { connect() {} };
                }
                createAnalyser() {
                    return {
                        fftSize: 1,
                        minDecibels: -100,
                        getFloatTimeDomainData(data: Float32Array) {
                            data.fill(amplitude);
                        },
                    };
                }
            },
        },
        MediaRecorder: {
            configurable: true,
            value: jest.fn(() => recorder),
        },
        navigator: {
            configurable: true,
            value: {
                mediaDevices: {
                    getUserMedia: async () => ({}),
                },
            },
        },
        requestAnimationFrame: {
            configurable: true,
            value: animationFrame,
        },
    });
    recognizing = jest.fn();
    recognized = jest.fn();
    onError = jest.fn();
    recognizer = new WhisperRecognizer();
    recognizer.onRecognizing(recognizing);
    recognizer.onRecognized(recognized);
    recognizer.onError(onError);
    await recognizer.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of originalGlobals) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, name);
        }
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
});

it.each([
    { final: false, outcome: "success" },
    { final: false, outcome: "error" },
    { final: true, outcome: "success" },
    { final: true, outcome: "error" },
])(
    "ignores an earlier recording's $outcome (final: $final)",
    async ({ final, outcome }) => {
        const previous = createPromiseWithResolvers<Response>();
        const current = createPromiseWithResolvers<Response>();
        fetchMock
            .mockReturnValueOnce(previous.promise)
            .mockReturnValueOnce(current.promise);
        recognizer.startRecording();
        if (final) {
            recognizer.stopRecording();
        }
        const staleResult = recorder.emitData(new Blob(["old audio"]));
        if (!final) {
            recognizer.stopRecording();
        }
        recognizer.startRecording();
        const activeResult = recorder.emitData(new Blob(["new audio"]));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const body = fetchMock.mock.calls[1]?.[1]?.body;
        if (!(body instanceof FormData)) {
            throw new Error("Expected a multipart transcription request.");
        }
        const audio = body.get("file");
        if (!(audio instanceof Blob)) {
            throw new Error("Expected an audio file in the request.");
        }
        expect(await audio.text()).toBe("new audio");

        if (outcome === "error") {
            previous.reject(new Error("Previous recording failed."));
        } else {
            previous.resolve(
                new Response(JSON.stringify({ transcription: "old text" })),
            );
        }
        await staleResult;
        expect(recorder.state).toBe("recording");
        expect(recorder.stop).toHaveBeenCalledTimes(1);
        expect(recognizing).not.toHaveBeenCalled();
        expect(recognized).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();

        await recorder.emitData();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        current.resolve(
            new Response(JSON.stringify({ transcription: "new text" })),
        );
        await activeResult;
        expect(recognizing).toHaveBeenCalledWith({ text: "new text" });
        expect(onError).not.toHaveBeenCalled();
    },
);

it("reports a current failure, stops its recording, and permits a retry", async () => {
    const failure = new Error("The audio upload exceeded the time limit.");
    fetchMock.mockRejectedValueOnce(failure);
    recognizer.startRecording();
    await recorder.emitData();
    expect(recorder.state).toBe("inactive");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(console.error).toHaveBeenCalledWith(
        "Local transcription failed:",
        failure,
    );
    await recorder.emitData();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ transcription: "retry" })),
    );
    recognizer.startRecording();
    await recorder.emitData();
    expect(recognizing).toHaveBeenCalledWith({ text: "retry" });
    expect(recorder.state).toBe("recording");
    expect(onError).toHaveBeenCalledTimes(1);
});

it("reports only one failure when interim and final requests both fail", async () => {
    const interim = createPromiseWithResolvers<Response>();
    const final = createPromiseWithResolvers<Response>();
    fetchMock
        .mockReturnValueOnce(interim.promise)
        .mockReturnValueOnce(final.promise);
    recognizer.startRecording();
    const interimResult = recorder.emitData();
    recognizer.stopRecording();
    const finalResult = recorder.emitData();
    const failure = new Error("Transcription failed.");
    interim.reject(failure);
    await interimResult;
    final.reject(new Error("Final transcription failed."));
    await finalResult;
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(recognizing).not.toHaveBeenCalled();
    expect(recognized).not.toHaveBeenCalled();
});

it("preserves interim text and emits the final result only once", async () => {
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ transcription: "hello" })),
    );
    recognizer.startRecording();
    await recorder.emitData();
    expect(recognizing).toHaveBeenCalledWith({ text: "hello" });
    expect(recognized).not.toHaveBeenCalled();
    recognizer.stopRecording();
    await recorder.emitData();
    await recorder.emitData();
    expect(recognized).toHaveBeenCalledTimes(1);
    expect(recognized).toHaveBeenCalledWith({ text: "hello" });
});

it("allows the final callback to start the next recording", async () => {
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ transcription: "hello" })),
    );
    recognized.mockImplementation(() => recognizer.startRecording());
    recognizer.startRecording();
    recognizer.stopRecording();
    await recorder.emitData();
    recognizer.stopRecording();
    await recorder.emitData();
    expect(recognized).toHaveBeenCalledTimes(2);
});

it("does not let an earlier silence timer or animation loop stop a retry", () => {
    amplitude = 0;
    recognizer.startRecording();
    const previousFrame = animationFrame.mock.calls[0]?.[0];
    if (!previousFrame) {
        throw new Error("Expected a silence-check animation frame.");
    }
    recognizer.stopRecording();
    amplitude = 1;
    recognizer.startRecording();
    previousFrame(0);
    expect(animationFrame).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1000);
    expect(recorder.state).toBe("recording");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
});

it("still stops the current recording after silence", () => {
    amplitude = 0;
    recognizer.startRecording();
    jest.advanceTimersByTime(1000);
    expect(recorder.state).toBe("inactive");
    expect(recorder.stop).toHaveBeenCalledTimes(1);
});
