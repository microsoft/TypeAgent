// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getUserDevices, getPlaybackState } from "./endpoints.js";
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

function buildPlaybackEntities(
    status: SpotifyApi.CurrentPlaybackResponse,
    actionResult: ActionResultSuccess,
) {
    if (status.item && status.item.type === "track") {
        const artists = status.item.artists
            .map((artist) => artist.name)
            .join(", ");
        const pp = status.is_playing ? "" : "(paused)";
        const album = status.item.album.name;
        actionResult.historyText += `Now playing${pp}: ${status.item.name} from album ${album} by ${artists}`;
        actionResult.entities.push({
            name: status.item.name,
            type: ["track"],
            uniqueId: status.item.id,
        });
        for (const artist of status.item.artists) {
            actionResult.entities.push({
                name: artist.name,
                type: ["artist"],
                uniqueId: artist.id,
            });
        }
        actionResult.entities.push({
            name: album,
            type: ["album"],
            uniqueId: status.item.album.id,
        });
    }
}

function htmlPlaybackStatus(
    status: SpotifyApi.CurrentPlaybackResponse,
): string {
    if (!status.item) {
        return "<div class='now-playing-empty'>Nothing playing.</div>";
    }

    const item = status.item;
    const elapsed = msToElapsedMinSec(status.progress_ms ?? 0);
    const total = msToElapsedMinSec(item.duration_ms);
    const progressPct =
        item.duration_ms > 0
            ? Math.round(((status.progress_ms ?? 0) / item.duration_ms) * 100)
            : 0;
    const symbol = status.is_playing ? playSymbol : pauseSymbol;

    // Album art
    let albumArt = "";
    if (item.type === "track" && item.album.images.length > 0) {
        const img = item.album.images[0];
        albumArt = `<img src='${img.url}' alt='album cover' class='now-playing-art' />`;
    }

    // Artists
    let artistsHtml = "";
    if (item.type === "track") {
        artistsHtml = item.artists.map((a) => a.name).join(", ");
    }

    // Album name
    const albumName = item.type === "track" ? item.album.name : "";

    // Device info
    const device = status.device;
    const vol = device.volume_percent ?? 0;
    const shuffle = status.shuffle_state ? " &middot; Shuffle" : "";

    return `<div class='now-playing-card'>
  <div class='now-playing-top'>
    ${albumArt}
    <div class='now-playing-info'>
      <div class='now-playing-title'>${item.name}</div>
      <div class='now-playing-artist'>${artistsHtml}</div>
      <div class='now-playing-album'>${albumName}</div>
    </div>
  </div>
  <div class='now-playing-progress'>
    <div class='now-playing-times'>
      <span>${symbol} ${elapsed}</span><span>${total}</span>
    </div>
    <div class='now-playing-bar'>
      <div class='now-playing-bar-fill' style='width:${progressPct}%'></div>
    </div>
  </div>
  <div class='now-playing-device'>${device.name} &middot; ${vol}%${shuffle}</div>
</div>`;
}

export async function htmlStatus(context: IClientContext) {
    const status = await getPlaybackState(context.service);
    const displayContent: DisplayContent = {
        type: "html",
        content: "",
    };
    const actionResult: ActionResultSuccess = {
        historyText: "",
        entities: [],
        displayContent,
    };
    if (status) {
        buildPlaybackEntities(status, actionResult);
        displayContent.content = htmlPlaybackStatus(status);
        const device = status.device;
        actionResult.historyText += `\nActive device: ${device.name} of type ${device.type}\nVolume is ${device.volume_percent}%.`;
    } else {
        displayContent.content =
            "<div class='now-playing-empty'>Nothing playing.</div>";
        actionResult.historyText = "Nothing playing.";
    }
    actionResult.dynamicDisplayId = "status";
    actionResult.dynamicDisplayNextRefreshMs = 1000;
    return actionResult;
}

export async function printStatus(context: IClientContext) {
    const status = await getPlaybackState(context.service);
    if (!status) {
        console.log("Nothing playing according to Spotify.");
    }
    const devices = await getUserDevices(context.service);
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
