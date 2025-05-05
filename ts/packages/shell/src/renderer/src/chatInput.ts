// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
import { uint8ArrayToBase64 } from "common-utils";

export interface ExpandableTextareaHandlers {
    onSend: (text: string) => void;
    onChange?: (eta: ExpandableTextarea) => void;
    onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean;
    onMouseWheel?: (eta: ExpandableTextarea, event: WheelEvent) => void;
}

export class ExpandableTextarea {
    private textEntry: HTMLSpanElement;
    private entryHandlers: ExpandableTextareaHandlers;

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
            } else if (event.key == "Escape") {
                this.textEntry.textContent = "";
                event.preventDefault();
            }

            if (sendButton !== undefined) {
                sendButton.disabled = this.textEntry.innerHTML.length == 0;
            }

            return true;
        });
        this.textEntry.addEventListener("input", () => {
            if (this.entryHandlers.onChange !== undefined) {
                this.entryHandlers.onChange(this);
            }
        });
        this.textEntry.onchange = () => {
            if (sendButton !== undefined) {
                sendButton.disabled = this.textEntry.innerHTML.length == 0;
            }
        };
        this.textEntry.onwheel = (event) => {
            if (this.entryHandlers.onMouseWheel !== undefined) {
                this.entryHandlers.onMouseWheel(this, event);
            }
        };
    }

    getTextEntry() {
        return this.textEntry;
    }

    setContent(content: string | null) {
        if (this.textEntry.textContent !== content) {
            this.textEntry.textContent = content;
        }

        this.moveCursorToEnd();
    }

    public moveCursorToEnd() {
        // Set the cursor to the end of the text
        const r = document.createRange();
        if (this.textEntry.childNodes.length > 0) {
            r.selectNode(this.textEntry);
            r.setStartBefore(this.textEntry.childNodes[0]);
            r.setEndAfter(
                this.textEntry.childNodes[this.textEntry.childNodes.length - 1],
            );
            r.collapse(false);
            const s = document.getSelection();
            if (s) {
                s.removeAllRanges();
                s.addRange(r);
            }
        }
    }

    replaceTextAtCursor(
        text: string,
        cursorOffset: number = 0,
        length: number = 0,
    ) {
        const s = document.getSelection();
        if (s) {
            if (s.rangeCount > 1) {
                return;
            }
            const currentRange = s.getRangeAt(0);
            if (!currentRange.collapsed) {
                return;
            }
            if (currentRange.startContainer === this.textEntry.childNodes[0]) {
                const currentText = this.textEntry.innerText;
                let offset = currentRange.startOffset + cursorOffset;
                if (offset < 0 || offset > currentText.length) {
                    return;
                }
                const prefix = this.textEntry.innerText.substring(0, offset);
                const suffix = this.textEntry.innerText.substring(
                    offset + length,
                );
                this.textEntry.innerText = prefix + text + suffix;

                const newRange = document.createRange();
                newRange.setEnd(
                    this.textEntry.childNodes[0],
                    prefix.length + text.length,
                );
                newRange.collapse(false);
                const s = document.getSelection();
                if (s) {
                    s.removeAllRanges();
                    s.addRange(newRange);
                }
            }
        }
    }
    send(sendButton?: HTMLButtonElement) {
        const text = this.getTextEntry().innerHTML;
        if (text.length > 0) {
            this.entryHandlers.onSend(text);
            this.textEntry.innerText = "";
            if (sendButton) {
                sendButton.disabled = true;
            }
        }
    }

    public focus() {
        setTimeout(() => this.textEntry.focus(), 0);
    }
}

export class ChatInput {
    private inputContainer: HTMLDivElement;
    public textarea: ExpandableTextarea;
    private micButton: HTMLButtonElement;
    public attachButton: HTMLButtonElement;
    public camButton: HTMLButtonElement;
    private dragTemp: string | undefined = undefined;
    //private fileInput: HTMLInputElement;
    public dragEnabled: boolean = true;
    public sendButton: HTMLButtonElement;
    private separator: HTMLDivElement;
    private separatorContainer: HTMLDivElement;
    constructor(
        inputId: string,
        buttonId: string,
        messageHandler: (message: string) => void,
        onChange?: (eta: ExpandableTextarea) => void,
        onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean,
        onMouseWheel?: (eta: ExpandableTextarea, event: WheelEvent) => void,
    ) {
        this.inputContainer = document.createElement("div");
        this.inputContainer.className = "chat-input";
        this.sendButton = document.createElement("button");
        this.sendButton.id = "sendbutton";
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
                onMouseWheel,
            },
            this.sendButton,
        );

        this.textarea.getTextEntry().onpaste = (e: ClipboardEvent) => {
            if (e.clipboardData !== null) {
                this.getTextFromDataTransfer(e.clipboardData);
            }
            e.preventDefault();
        };

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

            this.textarea.getTextEntry().innerText =
                "Drop image files or text here...";
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

            if (e.dataTransfer != null) {
                this.getTextFromDataTransfer(e.dataTransfer, true);
            }

            e.preventDefault();
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

        this.attachButton = document.createElement("button");
        //this.attachButton.htmlFor = this.fileInput.id;
        this.attachButton.appendChild(iconAttach());
        this.attachButton.className = "chat-input-button";

        getSpeechToken().then((result) => {
            if (
                result == undefined &&
                typeof Android !== "undefined" &&
                !Android?.isSpeechRecognitionSupported()
            ) {
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
        this.separatorContainer.className =
            "chat-input-button chat-input-separator-container";
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

    /**
     * Loads the contents of the supplied image into the input text box.
     * @param file The file whose contents to load
     */
    async loadImageFile(file: File) {
        const bytes = new Uint8Array(await file.arrayBuffer());

        this.loadImageContent(file.name, uint8ArrayToBase64(bytes));
    }

    /**
     * Creates and sets an image in the input text area.
     * @param mimeType The mime type of the supplied image content
     * @param content The base64 encoded image content
     */
    public async loadImageContent(fileName: string, content: string) {
        let mimeType = fileName
            .toLowerCase()
            .substring(fileName.lastIndexOf(".") + 1, fileName.length);

        if (fileName.toLowerCase().endsWith(".jpg")) {
            mimeType = "jpeg";
        }

        const supportedMimeTypes: Set<string> = new Set<string>([
            "jpg",
            "jpeg",
            "png",
        ]);

        if (!supportedMimeTypes.has(mimeType)) {
            console.log(`Unsupported MIME type for '${fileName}'`);
            this.textarea.getTextEntry().innerText = `Unsupported file type '${mimeType}'. Supported types: ${Array.from(supportedMimeTypes).toString()}`;
            return;
        }

        let dropImg: HTMLImageElement = document.createElement("img");
        dropImg.src = `data:image/${mimeType};base64,` + content;

        dropImg.className = "chat-input-dropImage";

        this.textarea.getTextEntry().append(dropImg);

        if (this.sendButton !== undefined) {
            this.sendButton.disabled =
                this.textarea.getTextEntry().innerHTML.length == 0;
        }

        this.textarea.focus();
    }

    clear() {
        this.textarea.getTextEntry().innerText = "";
        this.dragTemp = undefined;
    }

    getInputContainer() {
        return this.inputContainer;
    }

    public focus() {
        this.textarea.focus();
    }

    /**
     * Takes dataTransfer and gets a plain text representation from the data there
     * and loads it into the input box
     *
     * @param dataTransfer The dataTransfer object from drag/drop/paste events
     */
    public getTextFromDataTransfer(
        dataTransfer: DataTransfer,
        replace: boolean = false,
    ) {
        if (dataTransfer.files.length > 0) {
            this.loadImageFile(dataTransfer.files[0]);
        } else if (dataTransfer.items.length > 0) {
            // Only support pasting text versions of the data
            const data = dataTransfer.getData("text/plain");
            if (replace) {
                this.textarea.getTextEntry().innerText = data;
            } else {
                const s = document.getSelection();
                if (s && s.rangeCount > 0) {
                    s.deleteFromDocument();
                    // this also ignore line breaks in the string.
                    s.getRangeAt(0).insertNode(document.createTextNode(data));
                    s.collapseToEnd();
                }
            }
        }
    }
}
