// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { debugSpotifyError } from "./debug.js";
import { DeviceSettings } from "./devices.js";

// Roaming settings
export type RoamingSettings = {
    deviceSettings: Map<string, DeviceSettings>;
};

type RoamingSettingsJSON = {
    deviceSettings: [string, DeviceSettings][];
};

// local settings
export type LocalSettings = {
    defaultDeviceName?: string | undefined;
};

async function loadSettingData<T>(
    storage: Storage | undefined,
    fileName: string,
): Promise<T | undefined> {
    if (storage) {
        try {
            const data = await storage.read(fileName, "utf8");
            if (data) {
                return JSON.parse(data) as T;
            }
        } catch (error) {
            // ignore loading error.
            debugSpotifyError("Error loading device settings:", error);
        }
    }
    return undefined;
}

async function saveSettingData<T>(
    storage: Storage,
    settings: T,
    fileName: string,
): Promise<void> {
    const data = JSON.stringify(settings, null, 2);
    await storage.write(fileName, data, "utf8");
}

const localSettingFileName = "localSettings.json";
export async function loadLocalSettings(
    storage: Storage | undefined,
): Promise<LocalSettings> {
    return (
        (await loadSettingData<LocalSettings>(storage, localSettingFileName)) ??
        {}
    );
}

export async function saveLocalSettings(
    storage: Storage | undefined,
    settings: LocalSettings,
): Promise<void> {
    if (storage !== undefined) {
        await saveSettingData(storage, settings, localSettingFileName);
    }
}

const roamingSettingsFileName = "settings.json";
export async function loadRoamingSettings(
    storage: Storage | undefined,
): Promise<RoamingSettings> {
    const json = await loadSettingData<RoamingSettingsJSON>(
        storage,
        roamingSettingsFileName,
    );
    if (json === undefined) {
        return {
            deviceSettings: new Map<string, DeviceSettings>(),
        };
    }
    return {
        deviceSettings: new Map(json.deviceSettings),
    };
}

export async function saveRoamingSettings(
    storage: Storage | undefined,
    settings: RoamingSettings,
): Promise<void> {
    if (storage !== undefined) {
        const data: RoamingSettingsJSON = {
            deviceSettings: Array.from(settings.deviceSettings.entries()),
        };
        await saveSettingData(storage, data, roamingSettingsFileName);
    }
}
