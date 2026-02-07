// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    AppAgent,
    SessionContext,
    ActionContext,
    AppAgentEvent,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { LocalPlayerActions } from "./localPlayerSchema.js";
import {
    getLocalPlayerService,
    LocalPlayerService,
} from "../localPlayerService.js";
import { getLocalPlayerCommandInterface } from "./localPlayerCommands.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:localPlayer");

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeLocalPlayerContext,
        updateAgentContext: updateLocalPlayerContext,
        executeAction: executeLocalPlayerAction,
        ...getLocalPlayerCommandInterface(),
    };
}

export type LocalPlayerActionContext = {
    playerService: LocalPlayerService | undefined;
};

async function initializeLocalPlayerContext(): Promise<LocalPlayerActionContext> {
    return {
        playerService: undefined,
    };
}

async function updateLocalPlayerContext(
    enable: boolean,
    context: SessionContext<LocalPlayerActionContext>,
): Promise<void> {
    if (enable) {
        if (context.agentContext.playerService) {
            return;
        }
        try {
            context.agentContext.playerService = getLocalPlayerService();
            const musicFolder =
                context.agentContext.playerService.getMusicFolder();
            const message = `Local player enabled. Music folder: ${musicFolder}`;
            debug(message);
            context.notify(AppAgentEvent.Info, chalk.green(message));
        } catch (e: any) {
            const message = `Failed to initialize local player: ${e.message}`;
            debug(message);
            context.notify(AppAgentEvent.Error, chalk.red(message));
        }
    } else {
        if (context.agentContext.playerService) {
            context.agentContext.playerService.stop();
            context.agentContext.playerService = undefined;
        }
    }
}

async function executeLocalPlayerAction(
    action: TypeAgentAction<LocalPlayerActions>,
    context: ActionContext<LocalPlayerActionContext>,
) {
    const playerService = context.sessionContext.agentContext.playerService;

    if (!playerService) {
        return createActionResultFromError(
            "Local player not initialized. Use '@localPlayer on' to enable.",
        );
    }

    try {
        switch (action.actionName) {
            case "playFile":
                return handlePlayFile(
                    playerService,
                    action.parameters.fileName,
                );

            case "playFolder":
                return handlePlayFolder(
                    playerService,
                    action.parameters?.folderPath,
                    action.parameters?.shuffle,
                );

            case "playFromQueue":
                return handlePlayFromQueue(
                    playerService,
                    action.parameters.trackNumber,
                );

            case "status":
                return handleStatus(playerService);

            case "pause":
                return handlePause(playerService);

            case "resume":
                return handleResume(playerService);

            case "stop":
                return handleStop(playerService);

            case "next":
                return handleNext(playerService);

            case "previous":
                return handlePrevious(playerService);

            case "shuffle":
                return handleShuffle(playerService, action.parameters.on);

            case "repeat":
                return handleRepeat(playerService, action.parameters.mode);

            case "setVolume":
                return handleSetVolume(playerService, action.parameters.level);

            case "changeVolume":
                return handleChangeVolume(
                    playerService,
                    action.parameters.amount,
                );

            case "mute":
                return handleMute(playerService);

            case "unmute":
                return handleUnmute(playerService);

            case "listFiles":
                return handleListFiles(
                    playerService,
                    action.parameters?.folderPath,
                );

            case "searchFiles":
                return handleSearchFiles(
                    playerService,
                    action.parameters.query,
                );

            case "addToQueue":
                return handleAddToQueue(
                    playerService,
                    action.parameters.fileName,
                );

            case "clearQueue":
                return handleClearQueue(playerService);

            case "showQueue":
                return handleShowQueue(playerService);

            case "setMusicFolder":
                return handleSetMusicFolder(
                    playerService,
                    action.parameters.folderPath,
                );

            case "showMusicFolder":
                return handleShowMusicFolder(playerService);

            default:
                return createActionResultFromError(
                    `Unknown action: ${(action as any).actionName}`,
                );
        }
    } catch (error: any) {
        return createActionResultFromError(`Error: ${error.message}`);
    }
}

// Action handlers

async function handlePlayFile(service: LocalPlayerService, fileName: string) {
    const success = await service.playFile(fileName);
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>▶️ Now playing: <strong>${state.currentTrack?.name || fileName}</strong></p>`,
        );
    }
    return createActionResultFromError(`Could not find or play: ${fileName}`);
}

async function handlePlayFolder(
    service: LocalPlayerService,
    folderPath?: string,
    shuffle?: boolean,
) {
    const success = await service.playFolder(folderPath, shuffle || false);
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>▶️ Playing ${state.queue.length} tracks from folder${shuffle ? " (shuffled)" : ""}</p>
             <p>Now playing: <strong>${state.currentTrack?.name}</strong></p>`,
        );
    }
    return createActionResultFromError(
        "No audio files found in the specified folder",
    );
}

async function handlePlayFromQueue(
    service: LocalPlayerService,
    trackNumber: number,
) {
    const success = await service.playFromQueue(trackNumber);
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>▶️ Now playing track ${trackNumber}: <strong>${state.currentTrack?.name}</strong></p>`,
        );
    }
    return createActionResultFromError(`Invalid track number: ${trackNumber}`);
}

function handleStatus(service: LocalPlayerService) {
    const state = service.getState();

    let statusHtml = "<h3>🎵 Local Player Status</h3>";

    if (state.currentTrack) {
        const playIcon = state.isPlaying ? "▶️" : state.isPaused ? "⏸️" : "⏹️";
        statusHtml += `<p>${playIcon} <strong>${state.currentTrack.name}</strong></p>`;
    } else {
        statusHtml += "<p>No track loaded</p>";
    }

    statusHtml += `<p>Volume: ${state.volume}%${state.isMuted ? " (muted)" : ""}</p>`;
    statusHtml += `<p>Shuffle: ${state.shuffle ? "On" : "Off"} | Repeat: ${state.repeat}</p>`;
    statusHtml += `<p>Queue: ${state.queue.length} tracks</p>`;

    return createActionResultFromHtmlDisplay(statusHtml);
}

function handlePause(service: LocalPlayerService) {
    service.pause();
    return createActionResultFromHtmlDisplay("<p>⏸️ Paused</p>");
}

function handleResume(service: LocalPlayerService) {
    service.resume();
    return createActionResultFromHtmlDisplay("<p>▶️ Resumed</p>");
}

function handleStop(service: LocalPlayerService) {
    service.stop();
    return createActionResultFromHtmlDisplay("<p>⏹️ Stopped</p>");
}

async function handleNext(service: LocalPlayerService) {
    const success = await service.next();
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>⏭️ Next: <strong>${state.currentTrack?.name}</strong></p>`,
        );
    }
    return createActionResultFromError("No next track available");
}

async function handlePrevious(service: LocalPlayerService) {
    const success = await service.previous();
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>⏮️ Previous: <strong>${state.currentTrack?.name}</strong></p>`,
        );
    }
    return createActionResultFromError("No previous track available");
}

function handleShuffle(service: LocalPlayerService, on: boolean) {
    service.setShuffle(on);
    return createActionResultFromHtmlDisplay(
        `<p>🔀 Shuffle: ${on ? "On" : "Off"}</p>`,
    );
}

function handleRepeat(
    service: LocalPlayerService,
    mode: "off" | "one" | "all",
) {
    service.setRepeat(mode);
    const modeText =
        mode === "one"
            ? "Repeat One 🔂"
            : mode === "all"
              ? "Repeat All 🔁"
              : "Off";
    return createActionResultFromHtmlDisplay(`<p>Repeat: ${modeText}</p>`);
}

function handleSetVolume(service: LocalPlayerService, level: number) {
    service.setVolume(level);
    return createActionResultFromHtmlDisplay(`<p>🔊 Volume: ${level}%</p>`);
}

function handleChangeVolume(service: LocalPlayerService, amount: number) {
    service.changeVolume(amount);
    const state = service.getState();
    return createActionResultFromHtmlDisplay(
        `<p>🔊 Volume: ${state.volume}%</p>`,
    );
}

function handleMute(service: LocalPlayerService) {
    service.mute();
    return createActionResultFromHtmlDisplay("<p>🔇 Muted</p>");
}

function handleUnmute(service: LocalPlayerService) {
    service.unmute();
    return createActionResultFromHtmlDisplay("<p>🔊 Unmuted</p>");
}

function handleListFiles(service: LocalPlayerService, folderPath?: string) {
    const files = service.listFiles(folderPath);

    if (files.length === 0) {
        return createActionResultFromHtmlDisplay("<p>No audio files found</p>");
    }

    const fileListHtml = files
        .slice(0, 20)
        .map((f, i) => `<li>${i + 1}. ${f.name}</li>`)
        .join("");

    let html = `<h3>📁 Audio Files (${files.length} total)</h3><ol>${fileListHtml}</ol>`;
    if (files.length > 20) {
        html += `<p><em>...and ${files.length - 20} more</em></p>`;
    }

    return createActionResultFromHtmlDisplay(html);
}

function handleSearchFiles(service: LocalPlayerService, query: string) {
    const files = service.searchFiles(query);

    if (files.length === 0) {
        return createActionResultFromHtmlDisplay(
            `<p>No files found matching: ${query}</p>`,
        );
    }

    const fileListHtml = files
        .slice(0, 20)
        .map((f, i) => `<li>${i + 1}. ${f.name}</li>`)
        .join("");

    let html = `<h3>🔍 Search Results for "${query}" (${files.length} found)</h3><ol>${fileListHtml}</ol>`;

    return createActionResultFromHtmlDisplay(html);
}

function handleAddToQueue(service: LocalPlayerService, fileName: string) {
    const success = service.addFileToQueue(fileName);
    if (success) {
        const state = service.getState();
        return createActionResultFromHtmlDisplay(
            `<p>➕ Added to queue: <strong>${fileName}</strong> (${state.queue.length} in queue)</p>`,
        );
    }
    return createActionResultFromError(`Could not find: ${fileName}`);
}

function handleClearQueue(service: LocalPlayerService) {
    service.clearQueue();
    return createActionResultFromHtmlDisplay("<p>🗑️ Queue cleared</p>");
}

function handleShowQueue(service: LocalPlayerService) {
    const queue = service.getQueue();
    const state = service.getState();

    if (queue.length === 0) {
        return createActionResultFromHtmlDisplay("<p>Queue is empty</p>");
    }

    const queueHtml = queue
        .slice(0, 20)
        .map((track, i) => {
            const current = i === state.currentIndex ? " ▶️" : "";
            return `<li>${i + 1}. ${track.name}${current}</li>`;
        })
        .join("");

    let html = `<h3>📋 Playback Queue (${queue.length} tracks)</h3><ol>${queueHtml}</ol>`;
    if (queue.length > 20) {
        html += `<p><em>...and ${queue.length - 20} more</em></p>`;
    }

    return createActionResultFromHtmlDisplay(html);
}

function handleSetMusicFolder(service: LocalPlayerService, folderPath: string) {
    const success = service.setMusicFolder(folderPath);
    if (success) {
        return createActionResultFromHtmlDisplay(
            `<p>📁 Music folder set to: <strong>${folderPath}</strong></p>`,
        );
    }
    return createActionResultFromError(`Invalid folder path: ${folderPath}`);
}

function handleShowMusicFolder(service: LocalPlayerService) {
    const folder = service.getMusicFolder();
    return createActionResultFromHtmlDisplay(
        `<p>📁 Music folder: <strong>${folder}</strong></p>`,
    );
}
