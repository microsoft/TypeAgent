// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as os from "node:os";
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

export type DeviceSettings = {
    maxVolume: number;
};

type DeviceInfo = SpotifyApi.UserDevice & { id: string };

async function getDeviceInfo(
    service: SpotifyService,
    name?: string,
): Promise<DeviceInfo | undefined> {
    const devices = (await getUserDevices(service)).devices;
    if (devices.length === 0) {
        return undefined;
    }

    if (name === undefined) {
        const hostName = getHostName().toLowerCase();
        // If no name is provided, return the first device that has an id.
        return devices.find(
            (d) => d.name.toLowerCase() === hostName && d.id !== null,
        ) as DeviceInfo | undefined;
    }
    return devices.find((d) => d.name === name && d.id !== null) as
        | DeviceInfo
        | undefined;
}

async function ensureGetDeviceInfos(
    context: IClientContext,
): Promise<DeviceInfo[]> {
    const devicesResponse = await getUserDevices(context.service);
    const devices = devicesResponse.devices.filter((d) => d.id !== null);
    if (devices.length === 0) {
        throw new Error("No devices found.");
    }
    return devices as DeviceInfo[];
}

function getHostName(): string {
    const host = os.hostname();
    if (os.platform() === "darwin") {
        // On macOS, strip the .local
        const split = host.split(".");
        if (split.length > 1 && split[split.length - 1] === "local") {
            split.pop(); // remove the last element
            return split.join(".");
        }
    }
    return host;
}

function getDefaultDeviceName(
    clientContext: IClientContext,
): string | undefined {
    return clientContext.localSettings.defaultDeviceName;
}
function getSelectedDeviceName(
    clientContext: IClientContext,
): string | undefined {
    return (
        clientContext.selectedDeviceName ?? getDefaultDeviceName(clientContext)
    );
}

async function getSelectedDeviceInfo(
    clientContext: IClientContext,
): Promise<DeviceInfo | undefined> {
    return getDeviceInfo(
        clientContext.service,
        getSelectedDeviceName(clientContext),
    );
}

export async function ensureSelectedDeviceInfo(clientContext: IClientContext) {
    const device = await getSelectedDeviceInfo(clientContext);
    if (device === undefined) {
        const description = clientContext.selectedDeviceName
            ? `selected device '${clientContext.selectedDeviceName}'`
            : `default selected device '${getDefaultDeviceName(clientContext) ?? getHostName()}'`;
        throw new Error(`Unable to find ${description}.`);
    }
    return device;
}

export async function getSelectedDevicePlaybackState(
    clientContext: IClientContext,
) {
    const [selected, state] = await Promise.all([
        ensureSelectedDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (state === undefined || state.device.id === selected.id) {
        return state;
    }

    if (state.is_playing === true) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the selected device '${selected.name}'`,
        );
    }

    return undefined;
}

export async function ensureSelectedDeviceId(
    clientContext: IClientContext,
): Promise<string> {
    const [selected, state] = await Promise.all([
        ensureSelectedDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (
        state !== undefined &&
        state.device.id !== selected.id &&
        state.is_playing === true
    ) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the selected device '${selected.name}'`,
        );
    }
    return selected.id;
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
    device: DeviceInfo[],
): Promise<string[]> {
    const markdown: string[] = [];
    markdown.push("Available devices:");
    const selectedDevice = await getSelectedDeviceInfo(context);

    const state = await getPlaybackState(context.service);
    const playingId = state?.is_playing ? state.device.id : undefined;
    for (const d of device) {
        const selected = selectedDevice ? d.id === selectedDevice.id : false;
        const str = `${d.name} (${d.type})${selected ? " [selected]" : ""}${playingId === d.id ? " ▶️" : ""}`;
        markdown.push(`- ${selected ? chalk.green(str) : str}`);
    }
    return markdown;
}

export async function listDevicesAction(context: IClientContext) {
    const devices = await ensureGetDeviceInfos(context);
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
    const devices = await ensureGetDeviceInfos(clientContext);
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
        if (device.name === context.selectedDeviceName) {
            return createActionResult(
                `Device ${device.name} is already selected`,
                "warning",
                toDeviceEntity(device.name),
            );
        }
        context.selectedDeviceName = device.name;
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
    const selectedDeviceMessage = clientContext.selectedDeviceName
        ? `Explicit selected device not changed: '${clientContext.selectedDeviceName}'`
        : `Selected device is not explicitly set and will use the default device '${device.name}'.`;
    return createActionResult(
        `Default device set to '${device.name}' and will be used on next startup.\n${selectedDeviceMessage}`,
        "success",
        toDeviceEntity(device.name),
    );
}
