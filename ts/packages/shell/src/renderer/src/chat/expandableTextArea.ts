// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ExpandableTextareaHandlers {
    onSend: (html: string) => void;
    onChange?: (eta: ExpandableTextArea, isInput: boolean) => void;
    onKeydown?: (eta: ExpandableTextArea, event: KeyboardEvent) => boolean;
    onMouseWheel?: (eta: ExpandableTextArea, event: WheelEvent) => void;
}

export class ExpandableTextArea {
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
