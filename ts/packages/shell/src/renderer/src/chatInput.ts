// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { _arrayBufferToBase64, ChatView, setContent } from "./chatView";
import {
    iconMicrophone,
    iconMicrophoneListening,
    iconMicrophoneDisabled,
    iconCamera,
    iconAttach,
    iconSend,
} from "./icon";
import { getClientAPI } from "./main";
import { recognizeOnce } from "./speech";
import { getSpeechToken } from "./speechToken";

export interface ExpandableTextareaHandlers {
    onSend: (text: string) => void;
    altHandler?: (eta: ExpandableTextarea, event: KeyboardEvent) => void;
    onChange?: (eta: ExpandableTextarea) => void;
    onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean;
}

export class ExpandableTextarea {
    preText: HTMLSpanElement | undefined = undefined;
    textEntry: HTMLSpanElement;
    entryHandlers: ExpandableTextareaHandlers;

    constructor(
        id: string,
        className: string,
        handlers: ExpandableTextareaHandlers,
        sendButton?: HTMLButtonElement,
    ) {
        this.entryHandlers = handlers;
        this.textEntry = document.createElement("span");
        this.textEntry.className = className;
        this.textEntry.contentEditable = "true";
        this.textEntry.role = "textbox";
        this.textEntry.id = id;
        this.textEntry.addEventListener("keydown", (event) => {
            if (this.entryHandlers.onKeydown !== undefined) {
                if (!this.entryHandlers.onKeydown(this, event)) {
                    event.preventDefault();
                    return false;
                }
            }
            if (event.key === "Enter") {
                event.preventDefault();
                this.send(sendButton);
            } else if (
                event.altKey &&
                this.entryHandlers.altHandler !== undefined
            ) {
                this.entryHandlers.altHandler(this, event);
            } else if (event.key == "Escape") {
                this.textEntry.textContent = "";
                event.preventDefault();
            }
            return true;
        });
        this.textEntry.addEventListener("input", () => {
            if (this.entryHandlers.onChange !== undefined) {
                this.entryHandlers.onChange(this);
            }

            if (sendButton !== undefined) {
                sendButton.disabled = this.textEntry.innerHTML.length == 0;
            }
        });
    }

    getEditedText() {
        return this.getTextEntry().innerText.trim();
    }

    getTextEntry() {
        return this.textEntry;
    }

    setContent(content: string | null) {
        if (this.textEntry.textContent !== content) {
            this.textEntry.textContent = content;
        }

        // Set the cursor to the end of the text
        setTimeout(() => {
            const r = document.createRange();
            r.selectNodeContents(this.textEntry);
            r.collapse(false);
            const s = document.getSelection();
            if (s) {
                s.removeAllRanges();
                s.addRange(r);
            }
        }, 0);
    }

    send(sendButton?: HTMLButtonElement) {
        const text = this.getTextEntry().innerHTML;
        if (text.length > 0) {
            this.entryHandlers.onSend(text);
            this.textEntry.innerText = "";
            this.preText = undefined;
            if (sendButton) {
                sendButton.disabled = true;
            }
        }
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
            onSend: (html) => {
                // REVIEW: text is from innerHTML, is that ok?
                chatView.answer(questionId, html, id);
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
    attachButton: HTMLLabelElement;
    camButton: HTMLButtonElement;
    dragTemp: string | undefined = undefined;
    input: HTMLInputElement;
    public dragEnabled: boolean = true;
    sendButton: HTMLButtonElement;
    separator: HTMLDivElement;
    separatorContainer: HTMLDivElement;

    constructor(
        inputId: string,
        buttonId: string,
        messageHandler: (message: string) => void,
        onChange?: (eta: ExpandableTextarea) => void,
        onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean,
    ) {
        this.inputContainer = document.createElement("div");
        this.inputContainer.className = "chat-input";
        this.sendButton = document.createElement("button");
        this.sendButton.appendChild(iconSend());
        this.sendButton.className = "chat-input-button";
        this.sendButton.onclick = () => {
            this.textarea.send();
        };
        this.sendButton.disabled = true;
        this.textarea = new ExpandableTextarea(
            inputId,
            "user-textarea",
            {
                onSend: messageHandler,
                onChange,
                onKeydown,
            },
            this.sendButton,
        );

        this.textarea.getTextEntry().ondragenter = (e: DragEvent) => {
            if (!this.dragEnabled) {
                return;
            }

            e.preventDefault();
            console.log(e);

            if (this.dragTemp === undefined) {
                this.dragTemp = this.textarea.getTextEntry().innerHTML;
            }

            console.log("enter " + this.dragTemp);

            this.textarea.getTextEntry().innerText = "Drop image files here...";
            this.textarea.getTextEntry().classList.add("chat-input-drag");
        };

        this.textarea.getTextEntry().ondragleave = (e: DragEvent) => {
            if (!this.dragEnabled) {
                return;
            }

            this.textarea.getTextEntry().classList.remove("chat-input-drag");

            if (this.dragTemp) {
                this.textarea.getTextEntry().innerHTML = this.dragTemp;
                this.dragTemp = undefined;
            }
            e.preventDefault();

            console.log("leave " + this.dragTemp);
        };

        this.textarea.getTextEntry().ondrop = async (e: DragEvent) => {
            if (!this.dragEnabled) {
                return;
            }

            console.log(e);

            this.textarea.getTextEntry().classList.remove("chat-input-drag");
            if (this.dragTemp) {
                this.textarea.getTextEntry().innerHTML = this.dragTemp;
            } else {
                this.clear();
            }

            this.dragTemp = undefined;

            if (e.dataTransfer != null && e.dataTransfer.files.length > 0) {
                this.loadImageFile(e.dataTransfer.files[0]);
            }

            e.preventDefault();
        };

        this.input = document.createElement("input");
        this.input.type = "file";
        this.input.classList.add("chat-message-hidden");
        this.input.id = "image_upload";
        this.inputContainer.append(this.input);
        this.input.accept = "image/*,.jpg,.png,.gif";
        this.input.onchange = () => {
            if (this.input.files && this.input.files?.length > 0) {
                this.loadImageFile(this.input.files[0]);
            }
        };

        this.micButton = document.createElement("button");
        this.micButton.appendChild(iconMicrophone());
        this.micButton.id = buttonId;
        this.micButton.className = "chat-input-button";
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
                recognizeOnce(
                    await getSpeechToken(),
                    inputId,
                    buttonId,
                    messageHandler,
                );
            }
        });

        const listeningMic = iconMicrophoneListening();
        listeningMic.className = "chat-message-hidden";
        this.micButton.appendChild(listeningMic);

        const disabledMic = iconMicrophoneDisabled();
        disabledMic.className = "chat-message-hidden";
        this.micButton.appendChild(disabledMic);

        this.camButton = document.createElement("button");
        this.camButton.appendChild(iconCamera());
        this.camButton.className = "chat-input-button";

        this.attachButton = document.createElement("label");
        this.attachButton.htmlFor = this.input.id;
        this.attachButton.appendChild(iconAttach());
        this.attachButton.className = "chat-input-button";

        getSpeechToken().then((result) => {
            if (result == undefined) {
                const button = document.querySelector<HTMLButtonElement>(
                    `#${buttonId}`,
                )!;
                button.disabled = true;
                button.children[0].classList.add("chat-message-hidden");
                button.children[1].classList.add("chat-message-hidden");
                button.children[2].classList.remove("chat-message-hidden");
            }
        });

        this.separatorContainer = document.createElement("div");
        this.separatorContainer.className = "chat-input-button chat-input-separator-container";
        this.separator = document.createElement("div");
        this.separator.className = "chat-input-separator";
        this.separatorContainer.append(this.separator);

        this.inputContainer.appendChild(this.textarea.getTextEntry());
        this.inputContainer.appendChild(this.attachButton);
        this.inputContainer.appendChild(this.camButton);
        this.inputContainer.appendChild(this.micButton);
        this.inputContainer.appendChild(this.separatorContainer);
        this.inputContainer.appendChild(this.sendButton);
    }

    async loadImageFile(file: File) {
        let buffer: ArrayBuffer = await file.arrayBuffer();

        let dropImg: HTMLImageElement = document.createElement("img");
        let mimeType = file.name
            .toLowerCase()
            .substring(file.name.lastIndexOf(".") + 1, file.name.length);

        if (file.name.toLowerCase().endsWith(".jpg")) {
            mimeType = "jpeg";
        }

        dropImg.src =
            `data:image/${mimeType};base64,` + _arrayBufferToBase64(buffer);

        dropImg.className = "chat-input-dropImage";

        this.textarea.getTextEntry().append(dropImg);

        if (this.sendButton !== undefined) {
            this.sendButton.disabled =
                this.textarea.textEntry.innerHTML.length == 0;
        }

        this.textarea.getTextEntry().focus();
    }

    clear() {
        this.textarea.getTextEntry().innerText = "";
        this.dragTemp = undefined;
    }

    getInputContainer() {
        return this.inputContainer;
    }
}
