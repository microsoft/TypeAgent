// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { enumerateMicrophones } from "./speech";
import {
    defaultSettings,
    ShellSettingsType,
} from "../../main/shellSettingsType.js";
import { TabView } from "./tabView.js";
import { ChatView } from "./chatView.js";
import { getTTS, getTTSProviders, getTTSVoices } from "./tts.js";

async function updateSelectAsync(
    select: HTMLSelectElement,
    optionsP: Promise<string[] | [string, string][]>,
    value: () => string,
    enable?: () => boolean,
) {
    select.options.length = 0;

    const loading = new Option("Loading....");
    select.add(loading);
    select.disabled = true;

    const options = await optionsP;
    if (select.options[0] !== loading) {
        return false;
    }
    if (options.length !== 0) {
        select.options.length = 0;
        select.add(new Option("<default>"));
        for (const option of options) {
            select.options.add(
                Array.isArray(option)
                    ? new Option(option[0], option[1])
                    : new Option(option),
            );
        }
        select.value = value();
        select.disabled = enable?.() === false;
    } else {
        select.options.length = 0;
    }
    return true;
}

export class SettingsView {
    private microphoneSources: HTMLSelectElement;
    private mainContainer: HTMLDivElement;
    private menuCheckBox: HTMLInputElement;
    private tabsCheckBox: HTMLInputElement;
    private ttsCheckBox: HTMLInputElement;
    private ttsProvider: HTMLSelectElement;
    private ttsVoice: HTMLSelectElement;
    private _shellSettings: ShellSettingsType = defaultSettings;
    private updateFromSettings: () => Promise<void>;
    public get shellSettings(): Readonly<ShellSettingsType> {
        return this._shellSettings;
    }

    public set shellSettings(value: ShellSettingsType) {
        this._shellSettings = value;
        this.menuCheckBox.checked = value.hideMenu;
        this.tabsCheckBox.checked = value.hideTabs;
        this.ttsCheckBox.checked = value.tts;
        this.microphoneSources.value = value.microphoneId ?? "";
        this.updateFromSettings();
    }

    private get ttsProviderSettingValue() {
        return this._shellSettings.ttsSettings.provider ?? "<default>";
    }
    private get ttsVoiceSettingValue() {
        return this._shellSettings.ttsSettings.voice ?? "<default>";
    }
    private get microphoneIdSettingsValue() {
        return this._shellSettings.microphoneId ?? "<default>";
    }
    private get ttsProviderSelectedValue() {
        return this.ttsProvider.value === "<default>"
            ? undefined
            : this.ttsProvider.value;
    }
    private get ttsVoiceSelectedValue() {
        return this.ttsVoice.value === "<default>"
            ? undefined
            : this.ttsVoice.value;
    }
    private get microphoneIdSelectedValue() {
        return this.microphoneSources.value === "<default>"
            ? undefined
            : this.microphoneSources.value;
    }

    private get microphoneNameSelectedValue() {
        return this.microphoneSources.value === "<default>"
            ? undefined
            : this.microphoneSources.selectedOptions[0].innerText;
    }

    public showTabs() {
        this._shellSettings.hideTabs = false;
        this.tabsCheckBox.checked = false;
        this.saveSettings();
    }

    constructor(tabsView: TabView, chatView: ChatView) {
        this.mainContainer = document.createElement("div");

        // microphone selection
        this.microphoneSources = this.addSelect(
            "Microphone",
            "microphoneSources",
            () => {
                if (this.microphoneSources.selectedIndex > -1) {
                    this._shellSettings.microphoneId =
                        this.microphoneIdSelectedValue;
                    this._shellSettings.microphoneName =
                        this.microphoneNameSelectedValue;
                } else {
                    this._shellSettings.microphoneId = undefined;
                    this._shellSettings.microphoneName = undefined;
                }
            },
        );

        updateSelectAsync(
            this.microphoneSources,
            enumerateMicrophones(),
            () => this.microphoneIdSettingsValue,
        );

        // auto-hide menu bar
        this.menuCheckBox = this.addCheckbox("Hide the main menu", () => {
            this._shellSettings.hideMenu = this.menuCheckBox.checked;
        });

        const updateTabsView = () => {
            if (this.shellSettings.hideTabs) {
                tabsView.hide();
            } else {
                tabsView.show();
            }
        };
        // auto-hide tabs
        this.tabsCheckBox = this.addCheckbox("Hide the tabs", () => {
            this._shellSettings.hideTabs = this.tabsCheckBox.checked;
            updateTabsView();
        });

        const updateChatView = () => {
            chatView.tts = this.shellSettings.tts
                ? getTTS(
                      this.shellSettings.ttsSettings.provider,
                      this.shellSettings.ttsSettings.voice,
                  )
                : undefined;
        };
        const updateTTSSelections = async () =>
            updateSelectAsync(
                this.ttsVoice,
                (async () => {
                    const updatedTTSProvider = await updateSelectAsync(
                        this.ttsProvider,
                        getTTSProviders(),
                        () => this.ttsProviderSettingValue,
                        () => this.shellSettings.tts,
                    );
                    if (updatedTTSProvider) {
                        const provider = this.ttsProviderSelectedValue;
                        if (provider !== undefined) {
                            return getTTSVoices(provider);
                        }
                    }
                    return [];
                })(),
                () => this.ttsVoiceSettingValue,
                () => this.shellSettings.tts,
            );

        // tts
        this.ttsCheckBox = this.addCheckbox("Enable TTS", () => {
            this._shellSettings.tts = this.ttsCheckBox.checked;
            updateChatView();
            updateTTSSelections();
        });

        this.ttsProvider = this.addSelect("TTS Provider", "ttsProvider", () => {
            this._shellSettings.ttsSettings = {
                provider: this.ttsProviderSelectedValue,
            };
            updateChatView();
            updateTTSSelections();
        });
        this.ttsVoice = this.addSelect("TTS Voice", "ttsVoice", () => {
            this._shellSettings.ttsSettings = {
                provider: this.ttsProviderSelectedValue,
                voice: this.ttsVoiceSelectedValue,
            };
            updateChatView();
        });

        updateTTSSelections();

        this.updateFromSettings = async () => {
            updateTabsView();
            updateChatView();
            await updateTTSSelections();
        };

        speechSynthesis.onvoiceschanged = () => {
            updateTTSSelections();
        };
    }

    getContainer() {
        return this.mainContainer;
    }

    private addSelect(labelText: string, id: string, onchange: () => void) {
        // microphone selection
        const div: HTMLDivElement = document.createElement("div");
        const label: HTMLDivElement = document.createElement("div");
        label.className = "setting-label";
        label.innerText = labelText;
        div.append(label);

        const select = document.createElement("select");
        select.id = id;
        select.className = "chat-input-micSelector";
        div.appendChild(select);
        this.mainContainer.append(div);

        select.oninput = () => {
            onchange();
            this.saveSettings();
        };
        return select;
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
            this.saveSettings();
        };

        container.append(checkBox);
        container.append(label);
        this.mainContainer.append(container);

        return checkBox;
    }

    private saveSettings() {
        (window as any).electron.ipcRenderer.send(
            "save-settings",
            this.shellSettings,
        );
    }
}
