// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hostname } from "os";
import { IClientContext } from "./client.js";
import { getDevices, getPlaybackState, transferPlayback } from "./endpoints.js";
import { SpotifyService } from "./service.js";
import { Entity } from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import chalk from "chalk";

export type DeviceInfo = {
    name: string;
    id: string;
};

export type DeviceSettings = {
    maxVolume: number;
};

async function getDevice(service: SpotifyService, name: string) {
    const devices = await getDevices(service);
    if (devices === undefined || devices.devices.length === 0) {
        return undefined;
    }
    return devices.devices.find((d) => d.name === name && d.id !== null);
}

function getCurrentDeviceName(clientContext: IClientContext): string {
    return (
        clientContext.currentDeviceInfo?.name ??
        clientContext.localSettings.defaultDeviceName ??
        hostname()
    );
}
export async function getCurrentDevice(clientContext: IClientContext) {
    const name = getCurrentDeviceName(clientContext);
    const device = await getDevice(clientContext.service, name);
    if (device === undefined) {
        throw new Error(
            `Unable to find default device '${clientContext.localSettings.defaultDeviceName ?? hostname()}'`,
        );
    }
    return device;
}

async function getCurrentDeviceInfo(clientContext: IClientContext) {
    if (clientContext.currentDeviceInfo) {
        return clientContext.currentDeviceInfo;
    }
    const device = await getDevice(
        clientContext.service,
        clientContext.localSettings.defaultDeviceName ?? hostname(),
    );
    const current = device
        ? {
              name: device.name,
              id: device.id!,
          }
        : undefined;
    clientContext.currentDeviceInfo = current;
    return current;
}

export async function ensureCurrentDeviceInfo(clientContext: IClientContext) {
    const currentDevice = await getCurrentDeviceInfo(clientContext);
    if (currentDevice === undefined) {
        throw new Error(
            `Unable to find default device '${clientContext.localSettings.defaultDeviceName ?? hostname()}'`,
        );
    }
    return currentDevice;
}

export async function getCurrentDevicePlaybackState(
    clientContext: IClientContext,
) {
    const [currentDevice, state] = await Promise.all([
        ensureCurrentDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (state === undefined || state.device.id === currentDevice.id) {
        return state;
    }

    if (state.is_playing === true) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the current device '${currentDevice.name}'`,
        );
    }

    return undefined;
}

export async function ensureCurrentDeviceId(
    clientContext: IClientContext,
): Promise<string> {
    const [currentDevice, state] = await Promise.all([
        ensureCurrentDeviceInfo(clientContext),
        getPlaybackState(clientContext.service),
    ]);

    if (
        state !== undefined &&
        state.device.id !== currentDevice.id &&
        state.is_playing === true
    ) {
        throw new Error(
            `Music is currently playing on device '${state.device.name}', not the current device '${currentDevice.name}'`,
        );
    }
    return currentDevice.id;
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
    const currentDeviceInfo = await getCurrentDeviceInfo(context);

    const state = await getPlaybackState(context.service);
    const playingId = state?.is_playing ? state.device.id : undefined;
    for (const d of device) {
        const selected = d.id === currentDeviceInfo?.id;
        const str = `${d.name} (${d.type})${selected ? " [selected]" : ""}${playingId === d.id ? " ▶️" : ""}`;
        markdown.push(`- ${selected ? chalk.green(str) : str}`);
    }
    return markdown;
}

async function ensureGetDevices(
    context: IClientContext,
): Promise<SpotifyApi.UserDevice[]> {
    const devicesResponse = await getDevices(context.service);
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
        if (device.name === context.currentDeviceInfo?.name) {
            return createActionResult(
                `Device ${device.name} is already selected`,
                "warning",
                toDeviceEntity(device.name),
            );
        }
        context.currentDeviceInfo = {
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

export async function showSelectedDeviceAction(clientContext: IClientContext) {
    const { name } = await ensureCurrentDeviceInfo(clientContext);
    return createActionResult(
        `Current device: ${name}`,
        undefined,
        toDeviceEntity(name),
    );
}

export async function setDefaultDeviceAction(
    clientContext: IClientContext,
    deviceName?: string,
) {
    const name =
        deviceName ?? (await ensureCurrentDeviceInfo(clientContext)).name;
    const device = await findDevice(clientContext, name);
    if (device === undefined) {
        throw new Error(`Unable to find device '${deviceName}'`);
    }
    clientContext.localSettings.defaultDeviceName = device.name;
    return createActionResult(
        `Default device set to '${device.name}' and will be used on next startup.  Current device not changed: '${getCurrentDeviceName(clientContext)}'`,
        "success",
        toDeviceEntity(device.name),
    );
}
