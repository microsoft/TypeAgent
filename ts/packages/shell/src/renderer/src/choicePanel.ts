// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface InputChoice {
    element: HTMLElement;
    text: string;
    selectKey?: string[];
    value: any;
}

export class ChoicePanel {
    private panelDiv: HTMLDivElement;
    private keyDownHandler: (ev: KeyboardEvent) => void;
    constructor(
        insertAfter: HTMLElement,
        choices: InputChoice[],
        onSelected: (choice: InputChoice) => void,
    ) {
        this.panelDiv = document.createElement("div");
        this.panelDiv.className = "choice-panel";
        for (const choice of choices) {
            const choiceDiv = document.createElement("div");
            choiceDiv.className = "choice-button";
            choiceDiv.appendChild(choice.element);
            choiceDiv.appendChild(document.createTextNode(choice.text));
            choiceDiv.addEventListener("click", () => {
                onSelected(choice);
            });
            this.panelDiv.appendChild(choiceDiv);
        }
        insertAfter.after(this.panelDiv);

        this.keyDownHandler = (ev) => {
            if (!this.panelDiv.isConnected) {
                // In case that the panel was remove independently,
                // remove the event listerer now and ignore the keydown event.
                window.removeEventListener("keydown", this.keyDownHandler);
                return;
            }
            const key = ev.key;

            const choice = choices.find((c) => c.selectKey?.includes(key));
            if (choice) {
                ev.preventDefault();
                onSelected(choice);
            }
        };
        window.addEventListener("keydown", this.keyDownHandler);
    }

    public remove() {
        window.removeEventListener("keydown", this.keyDownHandler);
        this.panelDiv.remove();
    }
}
