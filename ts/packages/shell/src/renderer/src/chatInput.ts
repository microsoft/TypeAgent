// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatView, setContent } from "./chatView";
import {
    iconMicrophone,
    iconMicrophoneListening,
    iconMicrophoneDisabled,
    iconCamera,
    iconImage
} from "./icon";
import { getClientAPI } from "./main";
import { SpeechInfo, recognizeOnce } from "./speech";

export interface ExpandableTextareaHandlers {
    onSend: (text: string) => void;
    altHandler?: (eta: ExpandableTextarea, event: KeyboardEvent) => void;
    onChange?: (eta: ExpandableTextarea) => void;
    onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean;
}

export class ExpandableTextarea {
    preText: HTMLSpanElement | undefined = undefined;
    textEntry: HTMLSpanElement;

    constructor(
        id: string,
        className: string,
        handlers: ExpandableTextareaHandlers,
    ) {
        this.textEntry = document.createElement("span");
        this.textEntry.className = className;
        this.textEntry.contentEditable = "true";
        this.textEntry.role = "textbox";
        this.textEntry.id = id;
        this.textEntry.addEventListener("keydown", (event) => {
            if (handlers.onKeydown !== undefined) {
                if (!handlers.onKeydown(this, event)) {
                    event.preventDefault();
                    return false;
                }
            }
            if (event.key === "Enter") {
                event.preventDefault();
                const text = this.getEditedText();
                if (text.length > 0) {
                    handlers.onSend(text);
                    this.textEntry.innerText = "";
                    this.preText = undefined;
                }
            } else if (event.altKey && handlers.altHandler !== undefined) {
                handlers.altHandler(this, event);
            } else if (event.key == "Escape") {
                this.textEntry.textContent = "";
                event.preventDefault();
            }
            return true;
        });
        this.textEntry.addEventListener("input", () => {
            if (handlers.onChange !== undefined) {
                handlers.onChange(this);
            }
        });
    }

    getEditedText() {
        return this.getTextEntry().innerText.trim();
    }

    getTextEntry() {
        return this.textEntry;
    }
}

export function questionInput(
    chatView: ChatView,
    questionId: number,
    message: string,
    id: string,
) {
    // use this to type replacement JSON object for action
    // first make a container div
    const replacementContainer = document.createElement("div");
    replacementContainer.className = "replacement-container";
    // then add a title div to it
    const title = document.createElement("div");
    title.className = "replacement-title";
    setContent(title, message);
    replacementContainer.appendChild(title);
    // then add a replacement div to it
    const textarea = new ExpandableTextarea(
        "replacementDiv",
        "replacement-textarea",
        {
            onSend: (text) => {
                chatView.answer(questionId, text, id);
            },
        },
    );
    const replacementDiv = textarea.getTextEntry();
    setTimeout(() => {
        replacementDiv.focus();
    }, 0);
    replacementContainer.appendChild(textarea.getTextEntry());

    return replacementContainer;
}

export class ChatInput {
    inputContainer: HTMLDivElement;
    textarea: ExpandableTextarea;
    micButton: HTMLButtonElement;
    picButton: HTMLButtonElement;
    camButton: HTMLButtonElement;

    constructor(
        speechInfo: SpeechInfo,
        inputId: string,
        buttonId: string,
        messageHandler: (message: string) => void,
        onChange?: (eta: ExpandableTextarea) => void,
        onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean,
    ) {
        this.inputContainer = document.createElement("div");
        this.inputContainer.className = "chat-input";
        this.textarea = new ExpandableTextarea(inputId, "user-textarea", {
            onSend: messageHandler,
            onChange,
            onKeydown,
        });
        this.inputContainer.appendChild(this.textarea.getTextEntry());
        this.micButton = document.createElement("button");
        this.micButton.appendChild(iconMicrophone());
        this.micButton.id = buttonId;
        this.micButton.className = "chat-input-button";
        this.inputContainer.appendChild(this.micButton);
        this.micButton.addEventListener("click", async () => {
            const useLocalWhisper =
                await getClientAPI().getLocalWhisperStatus();
            if (useLocalWhisper) {
                recognizeOnce(
                    undefined,
                    inputId,
                    buttonId,
                    messageHandler,
                    useLocalWhisper,
                );
            } else {
                const curSpeechToken = speechInfo.speechToken;
                if (
                    curSpeechToken === undefined ||
                    curSpeechToken.expire <= Date.now()
                ) {
                    speechInfo.speechToken =
                        await getClientAPI().getSpeechToken();
                }
                if (speechInfo.speechToken !== undefined) {
                    recognizeOnce(
                        speechInfo.speechToken,
                        inputId,
                        buttonId,
                        messageHandler,
                    );
                } else {
                    console.log("no token");
                }
            }
        });

        this.picButton = document.createElement("button");
        this.picButton.appendChild(iconImage());
        this.picButton.className = "chat-input-button";
        this.inputContainer.appendChild(this.picButton)

        this.camButton = document.createElement("button")
        this.camButton.appendChild(iconCamera());
        this.camButton.className = "chat-input-button";
        this.inputContainer.appendChild(this.camButton);

        const listeningMic = iconMicrophoneListening();
        listeningMic.className = "chat-message-hidden";
        this.micButton.appendChild(listeningMic);

        const disabledMic = iconMicrophoneDisabled();
        disabledMic.className = "chat-message-hidden";
        this.micButton.appendChild(disabledMic);

        const curSpeechToken = speechInfo.speechToken;
        if (
            curSpeechToken === undefined ||
            curSpeechToken.expire <= Date.now()
        ) {
            getClientAPI()
                .getSpeechToken()
                .then((result) => {
                    speechInfo.speechToken = result;

                    if (result == undefined) {
                        const button =
                            document.querySelector<HTMLButtonElement>(
                                `#${buttonId}`,
                            )!;
                        button.disabled = true;
                        button.children[0].classList.add("chat-message-hidden");
                        button.children[1].classList.add("chat-message-hidden");
                        button.children[2].classList.remove(
                            "chat-message-hidden",
                        );
                    }
                });
        }
    }

    clear() {
        this.textarea.getTextEntry().innerText = "";
    }

    getInputContainer() {
        return this.inputContainer;
    }
}

