// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpeechToken } from "../../preload/electronTypes";
import {
    iconMicrophone,
    iconMicrophoneListening,
    iconMicrophoneDisabled,
    iconCamera,
    iconAttach,
    iconSend,
} from "./icon";
import { getClientAPI } from "./main";
import { needSpeechToken, recognizeOnce } from "./speech";
import { getSpeechToken } from "./speechToken";
import { uint8ArrayToBase64 } from "common-utils";

export interface ExpandableTextareaHandlers {
    onSend: (html: string) => void;
    onChange?: (eta: ExpandableTextarea, isInput: boolean) => void;
    onKeydown?: (eta: ExpandableTextarea, event: KeyboardEvent) => boolean;
    onMouseWheel?: (eta: ExpandableTextarea, event: WheelEvent) => void;
}

export class ExpandableTextarea {
    private readonly textEntry: HTMLSpanElement;
    private readonly entryHandlers: ExpandableTextareaHandlers;

    constructor(
        id: string,
        className: string,
        handlers: ExpandableTextareaHandlers,
        sendButton?: HTMLButtonElement,
    ) {
        this.entryHandlers = handlers;
        const textEntry = document.createElement("span");
        textEntry.className = className;
        textEntry.role = "textbox";
        textEntry.id = id;
        textEntry.addEventListener("keydown", (event) => {
            if (this.entryHandlers.onKeydown !== undefined) {
                if (!this.entryHandlers.onKeydown(this, event)) {
                    event.preventDefault();
                    return false;
                }
            }
            switch (event.key) {
                case "Enter":
                    event.preventDefault();
                    this.send(sendButton);
                    break;
                case "Escape":
                    textEntry.textContent = "";
                    event.preventDefault();
                    break;
            }

            if (sendButton !== undefined) {
                sendButton.disabled = textEntry.innerHTML.length === 0;
            }

            return true;
        });
        textEntry.addEventListener("input", () => {
            // Remove empty <br> elements that are created when delete the last of the content.
            if (
                textEntry.childNodes.length === 1 &&
                textEntry.childNodes[0].nodeType === Node.ELEMENT_NODE &&
                textEntry.childNodes[0].nodeName === "BR"
            ) {
                textEntry.removeChild(textEntry.childNodes[0]);
            }
            this.entryHandlers.onChange?.(this, true);
        });
        textEntry.addEventListener("paste", () => {
            this.entryHandlers.onChange?.(this, true);
        });
        textEntry.onchange = () => {
            if (sendButton !== undefined) {
                sendButton.disabled = this.textEntry.innerHTML.length === 0;
            }
        };
        textEntry.onwheel = (event) => {
            this.entryHandlers.onMouseWheel?.(this, event);
        };
        this.textEntry = textEntry;
    }

    public enable(enabled: boolean) {
        this.textEntry.contentEditable = enabled.toString();
    }
    getTextEntry() {
        return this.textEntry;
    }

    private updateCursorOnChange() {
        this.moveCursorToEnd();
        this.entryHandlers.onChange?.(this, false);
    }
    public getTextContent() {
        return this.textEntry.textContent ?? "";
    }
    public setTextContent(content: string = "") {
        this.textEntry.textContent = content;
        this.updateCursorOnChange();
    }

    public appendTextContent(content: string) {
        this.textEntry.textContent += content;
        this.updateCursorOnChange();
    }

    public async typeInputText(text: string) {
        // Clear existing content.
        this.setTextContent();
        for (let i = 0; i < text.length; i++) {
            this.appendTextContent(text[i]);
            // Simulate a key press delay to make it more natural
            // This is a random delay between 25 and 40 ms
            const keyDelay = 25 + Math.floor(Math.random() * 15);
            await new Promise((f) => setTimeout(f, keyDelay));
        }
    }

    public moveCursorToEnd() {
        // Set the cursor to the end of the text
        const r = document.createRange();
        const textEntry = this.textEntry;
        const childNodes = textEntry.childNodes;
        if (childNodes.length > 0) {
            r.selectNodeContents(textEntry);
            r.collapse(false);
            const s = document.getSelection();
            if (s) {
                s.removeAllRanges();
                s.addRange(r);
            }
            textEntry.scrollTop = textEntry.scrollHeight;
        }
    }

    public getSelectionEndNode() {
        let lastChild: Node = this.textEntry;
        while (lastChild.childNodes.length > 0) {
            lastChild = lastChild.childNodes[lastChild.childNodes.length - 1];
        }
        return lastChild;
    }

    send(sendButton?: HTMLButtonElement) {
        const html = this.getTextEntry().innerHTML;
        if (html.length > 0) {
            this.entryHandlers.onSend(html);
            this.setTextContent();
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
    public readonly recognizeOnce: (
        token: SpeechToken | undefined,
        useLocalWhisper: boolean,
    ) => void;

    constructor(
        handlers: ExpandableTextareaHandlers,
        inputId: string = "phraseDiv", // id for the text area for testing.
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
            handlers,
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

        const micButton = document.createElement("button");
        micButton.disabled = false;

        const micIcon = iconMicrophone();
        micIcon.className = "chat-message-hidden";

        micButton.appendChild(micIcon);
        micButton.className = "chat-input-button";
        micButton.disabled = true;

        const listeningMic = iconMicrophoneListening();
        listeningMic.className = "chat-message-hidden";
        micButton.appendChild(listeningMic);

        const disabledMic = iconMicrophoneDisabled();
        disabledMic.className = "chat-message-hidden";
        micButton.appendChild(disabledMic);

        this.micButton = micButton;

        const micReady = () => {
            micButton.disabled = false;
            micIcon.classList.remove("chat-message-hidden");
            listeningMic.classList.add("chat-message-hidden");
            disabledMic.classList.add("chat-message-hidden");
        };
        const micListening = () => {
            micButton.disabled = true;
            micIcon.classList.add("chat-message-hidden");
            listeningMic.classList.remove("chat-message-hidden");
            disabledMic.classList.add("chat-message-hidden");
        };
        const micNotReady = () => {
            micButton.disabled = false;
            micIcon.classList.add("chat-message-hidden");
            listeningMic.classList.add("chat-message-hidden");
            disabledMic.classList.remove("chat-message-hidden");
        };

        getClientAPI()
            .getLocalWhisperStatus()
            .then((useLocalWhisper) => {
                if (needSpeechToken(useLocalWhisper)) {
                    getSpeechToken().then((token) => {
                        if (token === undefined) {
                            micNotReady();
                        } else {
                            micReady();
                        }
                    });
                }
            });

        this.recognizeOnce = (
            token: SpeechToken | undefined,
            useLocalWhisper: boolean,
        ) => {
            if (micButton.disabled) {
                // Listening already.
                return;
            }

            if (needSpeechToken(useLocalWhisper) && token === undefined) {
                micNotReady();
                return;
            }
            micListening();
            this.textarea.setTextContent();
            recognizeOnce(
                token,
                // onRecognizing
                (text: string) => {
                    console.log("Running Recognizing step");
                    // Update the hypothesis line in the phrase/result view (only have one)
                    this.textarea.setTextContent(
                        this.textarea
                            .getTextContent()
                            .replace(
                                /(.*)(^|[\r\n]+).*\[\.\.\.\][\r\n]+/,
                                "$1$2",
                            ) + `${text} [...]\r\n`,
                    );
                },
                // onRecognized
                (text: string) => {
                    micReady();
                    this.textarea.setTextContent(text);
                    this.textarea.send();
                },
                // onError
                (error: string) => {
                    micReady();
                    console.log(error);
                    this.textarea.setTextContent();
                },
                useLocalWhisper,
            );
        };
        micButton.addEventListener("click", async () => {
            if (micButton.disabled) {
                // Listening already.
                return;
            }

            const useLocalWhisper =
                await getClientAPI().getLocalWhisperStatus();
            this.recognizeOnce(
                needSpeechToken(useLocalWhisper)
                    ? await getSpeechToken(false)
                    : undefined,
                useLocalWhisper,
            );
        });

        this.camButton = document.createElement("button");
        this.camButton.appendChild(iconCamera());
        this.camButton.className = "chat-input-button";

        this.attachButton = document.createElement("button");
        //this.attachButton.htmlFor = this.fileInput.id;
        this.attachButton.appendChild(iconAttach());
        this.attachButton.className = "chat-input-button";

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
            this.textarea.setTextContent(
                `Unsupported file type '${mimeType}'. Supported types: ${Array.from(supportedMimeTypes).toString()}`,
            );
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

    public async showInputText(message: string) {
        await this.textarea.typeInputText(message);
        this.textarea.send();
    }

    private clear() {
        this.textarea.setTextContent();
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
