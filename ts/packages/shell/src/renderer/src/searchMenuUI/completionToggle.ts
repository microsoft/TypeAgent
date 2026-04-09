// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CompletionToggleDirection = "expand" | "collapse";

export class CompletionToggle {
    private readonly element: HTMLDivElement;
    private direction: CompletionToggleDirection;

    constructor(
        direction: CompletionToggleDirection,
        onToggleMode: () => void,
    ) {
        this.direction = direction;
        this.element = document.createElement("div");
        this.applyDirection();
        this.element.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleMode();
        };
    }

    public setDirection(direction: CompletionToggleDirection) {
        if (this.direction === direction) {
            return;
        }
        this.direction = direction;
        this.applyDirection();
    }

    public show() {
        this.element.style.display = "";
    }

    public hide() {
        this.element.style.display = "none";
    }

    public getElement(): HTMLDivElement {
        return this.element;
    }

    public remove() {
        this.element.remove();
    }

    private applyDirection() {
        this.element.className = `completion-toggle completion-toggle-${this.direction}`;
        // ▲ expand: the completion menu opens *above* the input, so "expand up".
        // ▼ collapse: shrink back to inline ghost text.
        this.element.textContent =
            this.direction === "expand" ? "\u25B2" : "\u25BC";
    }
}
