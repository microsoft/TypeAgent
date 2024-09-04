// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enumerateMicrophones } from "./speech";
import {
    defaultSettings,
    ShellSettingsType,
} from "../../main/shellSettingsType.js";
import { TabView } from "./tabView.js";

export class SettingsView {
    public microphoneSources: HTMLSelectElement;
    private mainContainer: HTMLDivElement;
    public menuCheckBox: HTMLInputElement;
    public tabsCheckBox: HTMLInputElement;
    public shellSettings: ShellSettingsType = defaultSettings;

    constructor(window: any, tabs: TabView) {
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
            this.shellSettings.hideMenu = this.menuCheckBox.checked;

            window.electron.ipcRenderer.send(
                "settings-changed",
                this.shellSettings,
            );
        };

        menuContainer.append(this.menuCheckBox);
        menuContainer.append(label);
        this.mainContainer.append(menuContainer);

        // auto-hide tabs
        let tabContainer: HTMLDivElement = document.createElement("div");
        tabContainer.className = "settings-container";
        let tabLabel: HTMLLabelElement = document.createElement("label");

        tabLabel.innerText = "Hide the tabs";

        this.tabsCheckBox = document.createElement("input");
        this.tabsCheckBox.type = "checkbox";

        this.tabsCheckBox.onchange = () => {
            this.shellSettings.hideTabs = this.tabsCheckBox.checked;

            window.electron.ipcRenderer.send(
                "settings-changed",
                this.shellSettings,
            );

            if (this.tabsCheckBox.checked) {
                tabs.hide();
            }
        };

        tabContainer.append(this.tabsCheckBox);
        tabContainer.append(tabLabel);
        this.mainContainer.append(tabContainer);
    }

    getContainer() {
        return this.mainContainer;
    }
}
