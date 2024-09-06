// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enumerateMicrophones } from "./speech";
import {
    defaultSettings,
    ShellSettingsType,
} from "../../main/shellSettingsType.js";
import { TabView } from "./tabView.js";
import { ChatView } from "./chatView.js";

export class SettingsView {
    public microphoneSources: HTMLSelectElement;
    private mainContainer: HTMLDivElement;
    private menuCheckBox: HTMLInputElement;
    private tabsCheckBox: HTMLInputElement;
    private ttsCheckBox: HTMLInputElement;
    private _shellSettings: ShellSettingsType = defaultSettings;

    public get shellSettings(): Readonly<ShellSettingsType> {
        return this._shellSettings;
    }

    public set shellSettings(value: ShellSettingsType) {
        console.log(`update settings: ${JSON.stringify(value)}`);
        this.menuCheckBox.checked = value.hideMenu;
        this.tabsCheckBox.checked = value.hideTabs;
        this.ttsCheckBox.checked = value.tts;
    }

    public showTabs() {
        this._shellSettings.hideTabs = false;
        this.tabsCheckBox.checked = false;

        (window as any).electron.ipcRenderer.send(
            "settings-changed",
            this.shellSettings,
        );
    }

    constructor(window: any, tabs: TabView, chatView: ChatView) {
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
        this.menuCheckBox = this.addCheckbox("Hide the main menu", () => {
            this._shellSettings.hideMenu = this.menuCheckBox.checked;
        });

        // auto-hide tabs
        this.tabsCheckBox = this.addCheckbox("Hide the tabs", () => {
            this._shellSettings.hideTabs = this.tabsCheckBox.checked;
            if (this.tabsCheckBox.checked) {
                tabs.hide();
            }
        });

        // tts
        this.ttsCheckBox = this.addCheckbox("Enable text-to-speech", () => {
            this._shellSettings.tts = this.ttsCheckBox.checked;
            chatView.tts = this.ttsCheckBox.checked;
        });
    }

    getContainer() {
        return this.mainContainer;
    }

    private addCheckbox(labelText: string, onchange: () => void) {
        const container: HTMLDivElement = document.createElement("div");
        container.className = "settings-container";
        const label: HTMLLabelElement = document.createElement("label");

        label.innerText = labelText;

        const checkBox = document.createElement("input");
        checkBox.type = "checkbox";

        checkBox.onchange = () => {
            onchange();
            (window as any).electron.ipcRenderer.send(
                "settings-changed",
                this.shellSettings,
            );
        };

        container.append(checkBox);
        container.append(label);
        this.mainContainer.append(container);

        return checkBox;
    }
}
