// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enumerateMicrophones } from "./speech";

export class SettingsView {
    public microphoneSources: HTMLSelectElement;
    private mainContainer: HTMLDivElement;
    public menuCheckBox: HTMLInputElement;

    constructor(window: any) {
        this.mainContainer = document.createElement("div");

        // microphone selection
        let mic: HTMLDivElement = document.createElement("div");
        let micPrompt: HTMLDivElement = document.createElement("div");
        micPrompt.className = "setting-label";
        micPrompt.innerText = "Microphone";
        mic.append(micPrompt);

        this.microphoneSources = document.createElement("select");
        this.microphoneSources.id = "microphoneSources";
        this.microphoneSources.className = "chat-input-micSelector";
        mic.appendChild(this.microphoneSources);

        enumerateMicrophones(this.microphoneSources, window);

        this.mainContainer.append(mic);

        // auto-hide menu bar
        let menuContainer: HTMLDivElement = document.createElement("div");
        menuContainer.className = "settings-container";
        let label: HTMLLabelElement = document.createElement("label");

        label.innerText = "Hide the main menu";

        this.menuCheckBox = document.createElement("input");
        this.menuCheckBox.type = "checkbox";
        
        this.menuCheckBox.onchange = () => {
            window.electron.ipcRenderer.send("hide-menu-changed", this.menuCheckBox.checked)
        };

        menuContainer.append(this.menuCheckBox);
        menuContainer.append(label);

        this.mainContainer.append(menuContainer);
    }

    getContainer() {
        return this.mainContainer;
    }
}
