// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enumerateMicrophones } from "./speech";

export class SettingsView {

    private microphoneSources: HTMLSelectElement;
    private mainContainer: HTMLDivElement;

    constructor(
    ) {
        this.mainContainer = document.createElement("div");
        
        let mic: HTMLDivElement = document.createElement("div");
        let micPrompt: HTMLDivElement = document.createElement("div");
        micPrompt.className = "setting-label"
        micPrompt.innerText = "Microphone:"
        mic.append(micPrompt);

        this.microphoneSources = document.createElement("select");
        this.microphoneSources.id = "microphoneSources";
        this.microphoneSources.className = "chat-input-micSelector";
        mic.appendChild(this.microphoneSources);

        this.mainContainer.append(mic);
            
        enumerateMicrophones(this.microphoneSources);
    }

    getContainer() {
        return this.mainContainer;
    }

}