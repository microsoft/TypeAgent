// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureSelectedDeviceInfo, getSelectedUserDevice } from "./devices.js";
import { IClientContext } from "./client.js";
import { ActionIO, Storage } from "@typeagent/agent-sdk";
import { setVolume } from "./endpoints.js";
import { saveRoamingSettings } from "./settings.js";
import {
    createActionResult,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { SpotifyService } from "./service.js";

export async function setVolumeAction(
    clientContext: IClientContext,
    newVolumeLevel: number,
    actionIO: ActionIO,
) {
    if (newVolumeLevel < 0 || newVolumeLevel > 100) {
        throw new Error(`Invalid volume: ${newVolumeLevel}`);
    }
    const deviceSettings = clientContext.roamingSettings.deviceSettings;
    const { name, id } = await ensureSelectedDeviceInfo(clientContext);

    const maxVolume = deviceSettings.get(name)?.maxVolume ?? 100;
    const volume = Math.min(newVolumeLevel, maxVolume);
    if (volume !== newVolumeLevel) {
        actionIO.appendDisplay({
            type: "text",
            kind: "warning",
            content: `Volume ${newVolumeLevel} exceeds maximum limit of ${maxVolume} for device '${name}'. Setting to ${volume}.`,
        });
    }
    return setVolumeAmount(clientContext.service, name, volume, id!, actionIO);
}

export async function setMaxVolumeAction(
    clientContext: IClientContext,
    newMaxVolume: number,
    actionIO: ActionIO,
    instanceStorage: Storage | undefined,
) {
    if (newMaxVolume < 0 || newMaxVolume > 100) {
        throw new Error(`Invalid max volume: ${newMaxVolume}`);
    }
    const { name, id } = await ensureSelectedDeviceInfo(clientContext);

    const deviceSettings = clientContext.roamingSettings.deviceSettings;
    if (deviceSettings.has(name)) {
        const settings = deviceSettings.get(name)!;
        settings.maxVolume = newMaxVolume;
    } else {
        deviceSettings.set(name, { maxVolume: newMaxVolume });
    }
    await saveRoamingSettings(instanceStorage, clientContext.roamingSettings);
    const { volume_percent } = await getSelectedUserDevice(clientContext);
    if (volume_percent === null || volume_percent > newMaxVolume) {
        await setVolume(clientContext.service, id, newMaxVolume);
        actionIO.appendDisplay({
            type: "text",
            kind: "warning",
            content: `Device '${name}' volume set to ${newMaxVolume} to match new max volume.`,
        });
    }
    return createActionResultFromTextDisplay(
        `Device '${name}' max volume set to ${newMaxVolume}`,
    );
}

export async function changeVolumeAction(
    clientContext: IClientContext,
    volumeChangePercentage: number,
    actionIO: ActionIO,
) {
    const { name, id, volume_percent } =
        await getSelectedUserDevice(clientContext);
    const deviceSettings = clientContext.roamingSettings.deviceSettings;
    const maxVolume = deviceSettings.get(name)?.maxVolume ?? 100;
    const volpct = volume_percent ?? maxVolume;
    const volumeChangeFactor = 1 + volumeChangePercentage / 100;
    const newVolumeLevel = Math.floor(volumeChangeFactor * volpct);
    const volume = Math.min(newVolumeLevel, maxVolume);
    if (volume !== newVolumeLevel) {
        actionIO.appendDisplay({
            type: "text",
            kind: "warning",
            content: `Volume ${newVolumeLevel} exceeds maximum limit of ${maxVolume} for device '${name}'. Setting to ${volume}.`,
        });
    }
    return setVolumeAmount(clientContext.service, name, volume, id!, actionIO);
}

async function setVolumeAmount(
    service: SpotifyService,
    name: string,
    volume: number,
    id: string,
    actionIO: ActionIO,
) {
    actionIO.appendDisplay(
        {
            type: "text",
            kind: "status",
            content: `Setting device '${name}' volume to ${volume} ...`,
        },
        "temporary",
    );
    await setVolume(service, id, volume);
    return createActionResult(`Device '${name}' volume set to ${volume}`);
}
