// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, expect, it, jest } from "@jest/globals";
import { ChatPanel } from "../src/chatPanel.js";
import type { SpeechInputProvider, SpeechState } from "../src/providers.js";

let panel: ChatPanel | undefined;
afterEach(() => {
    panel?.dispose();
    document.body.innerHTML = "";
});

it("shows actual capture/finalizing state and replaces streaming textbox hypotheses without submitting", () => {
    let stateChanged: (state: SpeechState) => void = () => {};
    let result: (text: string, final: boolean) => void = () => {};
    const provider: SpeechInputProvider = {
        getState: () => "idle",
        start: () => {},
        stop: () => {},
        setContinuous: () => {},
        onStateChange: (callback) => {
            stateChanged = callback;
        },
        onResult: (callback) => {
            result = callback;
        },
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onSend = jest.fn();
    panel = new ChatPanel(root, {
        platformAdapter: { handleLinkClick() {} },
        speechProvider: provider,
        onSend,
    });
    const mic = root.querySelector<HTMLButtonElement>(".chat-mic-button")!;
    const banner = root.querySelector<HTMLElement>(".chat-voice-banner")!;
    const input = root.querySelector<HTMLElement>("#phraseDiv")!;

    stateChanged("preparing");
    expect(mic.disabled).toBe(true);
    expect(mic.classList.contains("listening")).toBe(false);
    expect(banner.textContent).toBe("Preparing speech recognition...");
    stateChanged("listening");
    expect(mic.disabled).toBe(false);
    expect(mic.classList.contains("listening")).toBe(true);
    result("turn", false);
    expect(input.textContent).toBe("turn");
    result("turn on the lights", false);
    expect(input.textContent).toBe("turn on the lights");
    stateChanged("finalizing");
    expect(mic.classList.contains("listening")).toBe(false);
    expect(banner.textContent).toBe("Finishing transcription...");
    result("Turn on the lights.", true);
    stateChanged("idle");
    expect(input.textContent).toBe("Turn on the lights.");
    expect(mic.disabled).toBe(false);
    expect(banner.style.display).toBe("none");
    expect(onSend).not.toHaveBeenCalled();
});
