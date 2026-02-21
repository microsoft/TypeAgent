// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OrbState =
    | "idle"
    | "wake-word-waiting"
    | "listening"
    | "thinking"
    | "speaking";

const orbLabels: Record<OrbState, string> = {
    idle: "",
    "wake-word-waiting": `Waiting for "TypeAgent"…`,
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking",
};

export class VoiceOrb {
    private _element: HTMLElement;
    private _state: OrbState = "idle";
    private _claudeFocus = false;

    constructor() {
        this._element = this._create();
    }

    get element(): HTMLElement {
        return this._element;
    }

    setState(state: OrbState): void {
        this._state = state;
        this._applyClasses();
        const label = this._element.querySelector<HTMLElement>(".orb-label");
        if (label) {
            label.textContent = orbLabels[state];
        }
    }

    setClaudeFocus(active: boolean): void {
        this._claudeFocus = active;
        this._applyClasses();
    }

    private _applyClasses(): void {
        const classes = ["voice-orb", `orb-${this._state}`];
        if (this._claudeFocus) {
            classes.push("claude-focus");
        }
        this._element.className = classes.join(" ");
    }

    private _create(): HTMLElement {
        const el = document.createElement("div");
        el.className = "voice-orb orb-idle";
        el.innerHTML = `
            <div class="orb-rings">
                <div class="orb-ring ring1"></div>
                <div class="orb-ring ring2"></div>
            </div>
            <div class="orb-inner"></div>
            <span class="orb-label"></span>`;
        return el;
    }
}
