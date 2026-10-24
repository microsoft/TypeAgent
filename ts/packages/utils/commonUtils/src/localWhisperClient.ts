// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function getLocalWhisperTranscription(
    blob: Blob,
    signal?: AbortSignal,
): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob);
    const response = await fetch("http://localhost:8001/transcribe/", {
        method: "POST",
        body: formData,
        ...(signal ? { signal } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
        const message =
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
                ? body.error
                : `Transcription failed with HTTP ${response.status}.`;
        throw new Error(message);
    }
    if (
        typeof body !== "object" ||
        body === null ||
        !("transcription" in body) ||
        typeof body.transcription !== "string"
    ) {
        throw new Error(
            "The transcription service returned an invalid response.",
        );
    }
    return body.transcription;
}
