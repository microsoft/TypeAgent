// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDevices, getPlaybackState, transferPlayback } from "./endpoints.js";
import { IClientContext } from "./client.js";
import chalk from "chalk";
import { TurnImpression } from "@typeagent/agent-sdk";

// convert milliseconds to elapsed minutes and seconds as a string
function msToElapsedMinSec(ms: number) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    // add leading zero if needed
    if (remainingSeconds < 10) {
        return `${minutes}:0${remainingSeconds}`;
    } else {
        return `${minutes}:${remainingSeconds}`;
    }
}

const pauseSymbol = "⏸️";
const playSymbol = "▶️";

export function chalkStatus(status: SpotifyApi.CurrentPlaybackResponse) {
    let result = "";
    if (status.item) {
        let timePart = msToElapsedMinSec(status.item.duration_ms);
        if (status.progress_ms) {
            timePart = `${msToElapsedMinSec(status.progress_ms)}/${timePart}`;
        }
        let symbol = status.is_playing ? playSymbol : pauseSymbol;
        console.log(
            `${symbol}  ${timePart}  ${chalk.cyanBright(status.item.name)}`,
        );
        result += `<div>${symbol}  ${timePart}  <span class='track-title'>${status.item.name}</span></div>\n`;
        if (status.item.type === "track") {
            const artists =
                "   Artists: " +
                status.item.artists
                    .map((artist) => chalk.green(artist.name))
                    .join(", ");
            const plainArtists =
                "   Artists: " +
                status.item.artists.map((artist) => artist.name).join(", ");
            result += `<div>${plainArtists}</div>\n`;
            console.log(artists);
        }
    }
    return result;
}

export function htmlPlaybackStatus(
    status: SpotifyApi.CurrentPlaybackResponse,
    turnImpression: TurnImpression,
) {
    let displayHTML = "";
    if (status.item) {
        let timePart = msToElapsedMinSec(status.item.duration_ms);
        if (status.progress_ms) {
            timePart = `${msToElapsedMinSec(status.progress_ms)}/${timePart}`;
        }
        let symbol = status.is_playing ? playSymbol : pauseSymbol;
        displayHTML += `<div>${symbol}  ${timePart}  <span class='track-title'>${status.item.name}</span></div>\n`;
        if (status.item.type === "track") {
            let artists = status.item.artists
                .map((artist) => artist.name)
                .join(", ");
            if (status.item.artists.length > 1) {
                artists = "artists: " + artists;
            } else {
                artists = "artist " + artists;
            }
            const pp = status.is_playing ? "" : "(paused)";
            const album = status.item.album.name;
            turnImpression.literalText += `Now playing${pp}: ${status.item.name} from album ${album} with ${artists}`;
            turnImpression.entities.push({
                name: status.item.name,
                type: ["track"],
            });
            // make an entity for each artist
            for (const artist of status.item.artists) {
                turnImpression.entities.push({
                    name: artist.name,
                    type: ["artist"],
                });
            }
            const plainArtists = "    A" + artists.substring(1);
            displayHTML += `<div>${plainArtists}</div>\n`;
            displayHTML += `<div>   Album: ${album}</div>\n`;
            turnImpression.entities.push({
                name: album,
                type: ["album"],
            });
        }
    }
    turnImpression.displayText += displayHTML;
}

export async function htmlStatus(context: IClientContext) {
    const status = await getPlaybackState(context.service);
    let turnImpression = {
        literalText: "",
        entities: [],
        displayText: "<div data-group='status'>Status...",
    } as TurnImpression;
    if (status) {
        htmlPlaybackStatus(status, turnImpression);
        const activeDevice = status.device;
        const aux = `Volume is ${activeDevice.volume_percent}%. ${status.shuffle_state ? "Shuffle on" : ""}`;
        turnImpression.displayText += `<div>Active device: ${activeDevice.name} of type ${activeDevice.type}</div>`;
        turnImpression.displayText += `<div>${aux}</div>`;
        turnImpression.literalText += `\nActive device: ${activeDevice.name} of type ${activeDevice.type}\n${aux}`;
    } else {
        console.log("Nothing playing according to Spotify.");
        turnImpression.displayText += "<div>Nothing playing.</div>";
        turnImpression.literalText = "Nothing playing.";
    }
    turnImpression.displayText += "</div>";
    const updateActionStatus = context.updateActionStatus;
    if (status && updateActionStatus) {
        let prevMessage = turnImpression.displayText;
        setTimeout(async () => {
            const updatedResult = await htmlStatus(context);
            if (updatedResult.displayText != prevMessage) {
                updateActionStatus(updatedResult.displayText, "status");
            }
        }, 1000);
    }
    return turnImpression;
}

export async function printStatus(context: IClientContext) {
    const status = await getPlaybackState(context.service);
    if (!status) {
        console.log("Nothing playing according to Spotify.");
    }
    const devices = await getDevices(context.service);
    if (devices && devices.devices.length > 0) {
        const activeDevice =
            devices.devices.find((device) => device.is_active) ??
            devices.devices[0];
        if (activeDevice) {
            console.log(
                "   Active device: " +
                    chalk.magenta(
                        `${activeDevice.name} of type ${activeDevice.type}`,
                    ),
            );
        } else {
            for (const device of devices.devices) {
                console.log(
                    chalk.magenta(
                        `   Device ${device.name} of type ${device.type} is available`,
                    ),
                );
            }
        }
    }
}

export async function selectDevice(keyword: string, context: IClientContext) {
    const devices = await getDevices(context.service);
    let result = "";
    if (devices && devices.devices.length > 0) {
        for (const device of devices.devices) {
            if (
                device.name.toLowerCase().includes(keyword.toLowerCase()) ||
                device.type.toLowerCase().includes(keyword.toLowerCase())
            ) {
                const status = await getPlaybackState(context.service);
                if (status) {
                    if (status.device.id === device.id) {
                        result += `<div>Device ${device.name} is already selected</div>\n`;
                        console.log(
                            chalk.green(
                                `Device ${device.name} is already selected`,
                            ),
                        );
                        return result;
                    }
                    await transferPlayback(
                        context.service,
                        device.id!,
                        status.is_playing,
                    );
                }
                context.deviceId = device.id!;
                result += `<div>Selected device ${device.name} of type ${device.type}</div>\n`;
                console.log(
                    chalk.green(
                        `Selected device ${device.name} of type ${device.type}`,
                    ),
                );
            }
        }
    } else {
        console.log(chalk.red("No devices matched keyword"));
        result += "<div>No devices matched keyword</div>\n";
    }
    return result;
}

export async function listAvailableDevices(context: IClientContext) {
    const devices = await getDevices(context.service);
    if (devices && devices.devices.length > 0) {
        let devHTML = "<div><div>Available Devices...</div><ul>\n";
        for (const device of devices.devices) {
            const description = `${device.name} (${device.type})${device.is_active ? " [active]" : ""}`;
            console.log(chalk.magenta(`Device ${description}`));
            devHTML += `<li>${description}</li>\n`;
        }
        devHTML += "</ul></div>";
        return devHTML;
    }
}
