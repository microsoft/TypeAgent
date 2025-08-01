// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hostname } from "os";
import { IClientContext } from "./client.js";
import {
    getUserDevices,
    getPlaybackState,
    transferPlayback,
} from "./endpoints.js";
import { SpotifyService } from "./service.js";
import { Entity, ResolveEntityResult, Storage } from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import chalk from "chalk";
import { saveLocalSettings } from "./settings.js";

export type DeviceInfo = {
    name: string;
    id: string;
};

export type DeviceSettings = {
    maxVolume: number;
};

async function getUserDevice(service: SpotifyService, name: string) {
    const devices = await getUserDevices(service);
    if (devices === undefined || devices.devices.length === 0) {
        return undefined;
    }
    return devices.devices.find((d) => d.name === name && d.id !== null);
}

function getSelectedDeviceName(clientContext: IClientContext): string {
    return (
        clientContext.selectedDeviceInfo?.name ??
        clientContext.localSettings.defaultDeviceName ??
        hostname()
    );
}
export async function getSelectedUserDevice(clientContext: IClientContext) {
    const name = getSelectedDeviceName(clientContext);
    const device = await getUserDevice(clientContext.service, name);
    if (device === undefined) {
        throw new Error(
            `Unable to find default device '${clientContext.localSettings.defaultDeviceName ?? hostname()}'`,
        );
    }
    return device;
}

async function getSelectedDeviceInfo(clientContext: IClientContext) {
    if (clientContext.selectedDeviceInfo) {
        return clientContext.selectedDeviceInfo;
    }
    const device = await getUserDevice(
        clientContext.service,
        clientContext.localSettings.defaultDeviceName ?? hostname(),
    );
    const selected = device
        ? {
              name: device.name,
              id: device.id!,
          }
        : undefined;
    clientContext.selectedDeviceInfo = selected;
    return selected;
}

export async function ensureSelectedDeviceInfo(clientContext: IClientContext) {
    const selectedDevice = await getSelectedDeviceInfo(clientContext);
    if (selectedDevice === undefined) {
        throw new Error(
            `Unable to find default device '${clientContext.localSettings.defaultDeviceName ?? hostname()}'`,
        );
    }
    return selectedDevice;
}

export async function getSelectedDevicePlaybackState(
    clientContext: IClientContext,
) {
    const [selectedDevice, state] = await Promise.all([
        ensureSelectedDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (state === undefined || state.device.id === selectedDevice.id) {
        return state;
    }

    if (state.is_playing === true) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the selected device '${selectedDevice.name}'`,
        );
    }

    return undefined;
}

export async function ensureSelectedDeviceId(
    clientContext: IClientContext,
): Promise<string> {
    const [selectedDevice, state] = await Promise.all([
        ensureSelectedDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (
        state !== undefined &&
        state.device.id !== selectedDevice.id &&
        state.is_playing === true
    ) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the selected device '${selectedDevice.name}'`,
        );
    }
    return selectedDevice.id;
}

function toDeviceEntity(name: string): Entity {
    return {
        name,
        type: ["MusicDevice"],
        uniqueId: name, // can't use device.id as it is not always stable.
    };
}

async function getDevicesMarkdown(
    context: IClientContext,
    device: SpotifyApi.UserDevice[],
): Promise<string[]> {
    const markdown: string[] = [];
    markdown.push("Available devices:");
    const selectedDeviceInfo = await getSelectedDeviceInfo(context);

    const state = await getPlaybackState(context.service);
    const playingId = state?.is_playing ? state.device.id : undefined;
    for (const d of device) {
        const selected = d.id === selectedDeviceInfo?.id;
        const str = `${d.name} (${d.type})${selected ? " [selected]" : ""}${playingId === d.id ? " ▶️" : ""}`;
        markdown.push(`- ${selected ? chalk.green(str) : str}`);
    }
    return markdown;
}

async function ensureGetDevices(
    context: IClientContext,
): Promise<SpotifyApi.UserDevice[]> {
    const devicesResponse = await getUserDevices(context.service);
    const devices = devicesResponse?.devices?.filter((d) => d.id !== null);
    if (devices === undefined || devices.length === 0) {
        throw new Error("No devices found.");
    }
    return devices;
}

export async function listDevicesAction(context: IClientContext) {
    const devices = await ensureGetDevices(context);
    return createActionResultFromMarkdownDisplay(
        await getDevicesMarkdown(context, devices),
        undefined,
        devices.map((d) => toDeviceEntity(d.name)),
    );
}

async function findDevice(
    clientContext: IClientContext,
    deviceName: string,
): Promise<SpotifyApi.UserDevice | undefined> {
    const devices = await ensureGetDevices(clientContext);
    return devices.find(
        (d) =>
            d.name.toLowerCase().includes(deviceName.toLowerCase()) ||
            d.type.toLowerCase().includes(deviceName.toLowerCase()),
    );
}

export async function selectDeviceAction(
    context: IClientContext,
    deviceName: string,
) {
    const device = await findDevice(context, deviceName);
    if (device !== undefined) {
        const status = await getPlaybackState(context.service);
        if (status && status.device.id !== device.id) {
            await transferPlayback(
                context.service,
                device.id!,
                status.is_playing,
            );
        }
        if (device.name === context.selectedDeviceInfo?.name) {
            return createActionResult(
                `Device ${device.name} is already selected`,
                "warning",
                toDeviceEntity(device.name),
            );
        }
        context.selectedDeviceInfo = {
            name: device.name,
            id: device.id!,
        };
        return createActionResult(
            `Selected device ${device.name} of type ${device.type}`,
            "success",
            toDeviceEntity(device.name),
        );
    }

    const state = await getPlaybackState(context.service);
    if (
        state &&
        state.is_playing &&
        state.device.name.toLowerCase().includes(deviceName.toLowerCase())
    ) {
        if (state.device.is_restricted) {
            throw new Error(
                `Cannot select device currently playing music '${state.device.name}' because it is restricted'`,
            );
        }

        throw new Error(
            `Cannot select device currently playing music '${state.device.name}' because it is not in the available devices list`,
        );
    }

    throw new Error(`No matching device found for '${deviceName}'`);
}

export async function resolveMusicDeviceEntity(
    clientContext: IClientContext,
    name: string,
): Promise<ResolveEntityResult | undefined> {
    const device = await findDevice(clientContext, name);
    if (device === undefined) {
        return undefined;
    }
    return {
        match:
            device.name.toLowerCase() === name.toLowerCase()
                ? "exact"
                : "fuzzy",
        entities: [toDeviceEntity(device.name)],
    };
}

export async function showSelectedDeviceAction(clientContext: IClientContext) {
    const { name } = await ensureSelectedDeviceInfo(clientContext);
    return createActionResult(
        `Current device: ${name}`,
        undefined,
        toDeviceEntity(name),
    );
}

export async function setDefaultDeviceAction(
    clientContext: IClientContext,
    deviceName?: string,
    instanceStorage?: Storage,
) {
    const name =
        deviceName ?? (await ensureSelectedDeviceInfo(clientContext)).name;
    const device = await findDevice(clientContext, name);
    if (device === undefined) {
        throw new Error(`Unable to find device '${deviceName}'`);
    }
    clientContext.localSettings.defaultDeviceName = device.name;
    await saveLocalSettings(instanceStorage, clientContext.localSettings);
    return createActionResult(
        `Default device set to '${device.name}' and will be used on next startup.  Current device not changed: '${getSelectedDeviceName(clientContext)}'`,
        "success",
        toDeviceEntity(device.name),
    );
}
