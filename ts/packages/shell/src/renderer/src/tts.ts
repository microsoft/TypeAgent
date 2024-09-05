// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.addEventListener("end", () => resolve());
        speechSynthesis.speak(utterance);
    });
}
