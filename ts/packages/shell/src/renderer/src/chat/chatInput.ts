// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExpandableTextArea,
    ExpandableTextareaHandlers,
} from "./expandableTextArea";
import {
    iconMicrophone,
    iconMicrophoneListening,
    iconMicrophoneDisabled,
    iconCamera,
    iconAttach,
    iconSend,
    iconMicrophoneContinuousListening,
} from "../icon";
import { getClientAPI } from "../main";
import { needSpeechToken, recognizeOnce, ContinousSpeechRecognizer } from "../speech";
import { getSpeechToken, SpeechToken } from "../speechToken";
import { uint8ArrayToBase64 } from "common-utils";

export class ChatInput {
    private inputContainer: HTMLDivElement;
    public textarea: ExpandableTextArea;
    private micButton: HTMLButtonElement;
    public attachButton: HTMLButtonElement;
    public camButton: HTMLButtonElement;
    private dragTemp: string | undefined = undefined;
    public dragEnabled: boolean = true;
    public sendButton: HTMLButtonElement;
    private separator: HTMLDivElement;
    private separatorContainer: HTMLDivElement;
    private listening: boolean = false;
    private continuous: boolean = false;
    public readonly recognizeOnce: (
        token: SpeechToken | undefined,
        useLocalWhisper: boolean,
    ) => void;
    public readonly startContinous: () => void;
    private continousRecognizer: ContinousSpeechRecognizer | undefined = undefined;
    private micIcon: HTMLElement;
    private listeningMic: HTMLElement;
    private disabledMic: HTMLElement;
    private alwaysOnMic: HTMLElement;
    private token: SpeechToken | undefined = undefined;
    private uselocalWhisper: boolean = false;

    constructor(
        handlers: ExpandableTextareaHandlers,
        inputId: string, // id for the text area for testing.
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
        this.textarea = new ExpandableTextArea(
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

        this.micButton = document.createElement("button");
        this.micButton.disabled = true;  // disabled until we get mic access and speech token        
        this.micButton.className = "chat-input-button";

        this.micIcon = iconMicrophone();
        this.micIcon.className = "chat-message-hidden";
        this.micButton.appendChild(this.micIcon);
        this.listeningMic = iconMicrophoneListening();
        this.listeningMic.className = "chat-message-hidden";
        this.micButton.appendChild(this.listeningMic);

        this.disabledMic = iconMicrophoneDisabled();
        this.disabledMic.className = "chat-message-hidden";
        this.micButton.appendChild(this.disabledMic);
        this.alwaysOnMic = iconMicrophoneContinuousListening();
        this.alwaysOnMic.className = "chat-message-hidden";
        this.micButton.appendChild(this.alwaysOnMic);

        getClientAPI()
            .getLocalWhisperStatus()
            .then((useLocalWhisper) => {
                this.uselocalWhisper = useLocalWhisper;
                if (needSpeechToken(useLocalWhisper)) {
                    getSpeechToken().then((token) => {
                        this.token = token;
                        if (token === undefined) {
                            this.micNotReady();
                        } else {
                            this.micReady();
                        }
                    });
                }
            });

        this.recognizeOnce = (
            token: SpeechToken | undefined,
            useLocalWhisper: boolean,
        ) => {
            if (this.listening) {
                this.listening = false;  // toggle listening so we just throw away speech reco results already in progress.
                return;
            }
            if (needSpeechToken(useLocalWhisper) && token === undefined) {
                this.micNotReady();
                return;
            }
            this.micListening();
            this.textarea.setTextContent();
            recognizeOnce(
                token,
                (text) => this.onRecognizing(text),
                (text) => this.onRecognized(text),
                (error) => this.onError(error),
                useLocalWhisper,
            );
        };
        this.startContinous = () => {
            if (this.continousRecognizer === undefined) {
                this.continousRecognizer = new ContinousSpeechRecognizer(
                    this.uselocalWhisper,
                    this.token,
                    (text) => this.onRecognizing(text),
                    (text) => this.onRecognized(text),
                    (error) => this.onError(error),
                )
            }
            this.continousRecognizer.start();
        };
        this.micButton.addEventListener("click", async (event) => {

            if (event.altKey || event.metaKey) {
                this.micContinuesListening();                
            } else {
                
                if (!this.listening && !this.continuous) {
                    this.startReco();
                } else if (this.continuous) {
                    this.continousRecognizer?.stop();
                }
                
                this.micReady();
            }
        });

        this.micButton.addEventListener("doubleclick", async () => {
            
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

    private onRecognizing(text: string) {

        // user cancelled speech recognition
        if (!this.listening) {
            return;
        }

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

        if (this.continuous) {
            // TODO: prefilter before sending    
        }
    }

    private onRecognized(text: string) {

        // only update the text if the user didn't cancel speech recognition
        if (this.listening || this.continuous) {
            this.textarea.setTextContent(text);
            this.textarea.send();            
        }

        if (!this.continuous) {
            this.listening = false;
            this.micReady();
        }
    }

    private onError(error: string) {
        this.micReady();
        console.log(error);
        this.textarea.setTextContent();
    }        

    private micReady() {
        this.listening = false;
        this.micButton.disabled = false;
        this.micIcon.classList.remove("chat-message-hidden");
        this.listeningMic.classList.add("chat-message-hidden");
        this.disabledMic.classList.add("chat-message-hidden");
        this.alwaysOnMic.classList.add("chat-message-hidden");
    }

    private micListening() {
        this.listening = true;
        this.micButton.disabled = false;
        this.micIcon.classList.add("chat-message-hidden");
        this.listeningMic.classList.remove("chat-message-hidden");
        this.disabledMic.classList.add("chat-message-hidden");
        this.alwaysOnMic.classList.add("chat-message-hidden");
    }

    private micNotReady() {
        this.listening = false;
        this.micButton.disabled = true;
        this.micIcon.classList.add("chat-message-hidden");
        this.listeningMic.classList.add("chat-message-hidden");
        this.disabledMic.classList.remove("chat-message-hidden");
        this.alwaysOnMic.classList.add("chat-message-hidden");
    }

    private micContinuesListening() {
        
        this.continuous = !this.continuous;
        this.listening = this.continuous;
        this.micButton.disabled = false;

        if (this.continuous) {

            this.startContinous();

            this.micIcon.classList.add("chat-message-hidden");
            this.listeningMic.classList.add("chat-message-hidden");
            this.disabledMic.classList.add("chat-message-hidden");
            this.alwaysOnMic.classList.remove("chat-message-hidden");
        } else {
            this.continuous = false;
            this.continousRecognizer?.stop();
            this.micReady();
        }
    }    

    /**
     * Starts speech recognition
     */
    public async startReco() {

        if (!this.listening) {
            const useLocalWhisper = await getClientAPI().getLocalWhisperStatus();
                this.recognizeOnce(
                    needSpeechToken(useLocalWhisper)
                        ? await getSpeechToken(false)
                        : undefined,
                    useLocalWhisper,
                );        
        }
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
