// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getLocalWhisperTranscription } from "../src/localWhisperClient.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

function respond(body: unknown, status = 200) {
    globalThis.fetch = async () =>
        new Response(JSON.stringify(body), { status });
}

it("posts the audio file and returns the transcription text", async () => {
    const calls: Parameters<typeof fetch>[] = [];
    globalThis.fetch = async (...args) => {
        calls.push(args);
        return new Response(JSON.stringify({ transcription: "hello" }));
    };
    expect(await getLocalWhisperTranscription(new Blob(["audio"]))).toBe(
        "hello",
    );
    expect(calls).toHaveLength(1);
    const [url, request] = calls[0] ?? [];
    expect(url).toBe("http://localhost:8001/transcribe/");
    expect(request?.method).toBe("POST");
    expect(request?.body).toBeInstanceOf(FormData);
});

it.each([400, 408, 413, 422, 503])(
    "reports the service message for HTTP %s",
    async (status) => {
        respond({ error: "Please retry." }, status);
        await expect(
            getLocalWhisperTranscription(new Blob(["audio"])),
        ).rejects.toThrow("Please retry.");
    },
);

it("reports a failed HTTP response without a service message", async () => {
    respond({}, 503);
    await expect(
        getLocalWhisperTranscription(new Blob(["audio"])),
    ).rejects.toThrow("Transcription failed with HTTP 503.");
});

it.each([{}, { transcription: null }, { transcription: 1 }])(
    "rejects an invalid successful response: %j",
    async (body) => {
        respond(body);
        await expect(
            getLocalWhisperTranscription(new Blob(["audio"])),
        ).rejects.toThrow(
            "The transcription service returned an invalid response.",
        );
    },
);
