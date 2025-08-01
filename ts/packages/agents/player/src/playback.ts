// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDevices, getPlaybackState } from "./endpoints.js";
import { IClientContext } from "./client.js";
import chalk from "chalk";
import { DisplayContent, ActionResultSuccess } from "@typeagent/agent-sdk";

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

function htmlPlaybackStatus(
    status: SpotifyApi.CurrentPlaybackResponse,
    actionResult: ActionResultSuccess,
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
            actionResult.literalText += `Now playing${pp}: ${status.item.name} from album ${album} with ${artists}`;
            actionResult.entities.push({
                name: status.item.name,
                type: ["track"],
                uniqueId: status.item.id,
            });
            // make an entity for each artist
            for (const artist of status.item.artists) {
                actionResult.entities.push({
                    name: artist.name,
                    type: ["artist"],
                    uniqueId: artist.id,
                });
            }
            const plainArtists = "    A" + artists.substring(1);
            displayHTML += `<div>${plainArtists}</div>\n`;
            displayHTML += `<div>   Album: ${album}</div>\n`;
            actionResult.entities.push({
                name: album,
                type: ["album"],
                uniqueId: status.item.album.id,
            });
        }
    }
    return displayHTML;
}

export async function htmlStatus(context: IClientContext) {
    const status = await getPlaybackState(context.service);
    const displayContent: DisplayContent = {
        type: "html",
        content: "<div data-group='status'>Status...",
    };
    const actionResult: ActionResultSuccess = {
        literalText: "",
        entities: [],
        displayContent,
    };
    if (status) {
        displayContent.content += htmlPlaybackStatus(status, actionResult);
        const activeDevice = status.device;
        const aux = `Volume is ${activeDevice.volume_percent}%. ${status.shuffle_state ? "Shuffle on" : ""}`;
        displayContent.content += `<div>Active device: ${activeDevice.name} of type ${activeDevice.type}</div>`;
        displayContent.content += `<div>${aux}</div>`;
        actionResult.literalText += `\nActive device: ${activeDevice.name} of type ${activeDevice.type}\n${aux}`;
    } else {
        displayContent.content += "<div>Nothing playing.</div>";
        actionResult.literalText = "Nothing playing.";
    }
    displayContent.content += "</div>";
    actionResult.dynamicDisplayId = "status";
    actionResult.dynamicDisplayNextRefreshMs = 1000;
    return actionResult;
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

