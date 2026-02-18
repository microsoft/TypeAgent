// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgentCommandInterface,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
    displayError,
} from "@typeagent/agent-sdk/helpers/display";
import {
    LocalPlayerActionContext,
    loadSettings,
    saveSettings,
} from "./localPlayerHandlers.js";

// Helper to get service with error handling
function getService(context: ActionContext<LocalPlayerActionContext>) {
    const service = context.sessionContext.agentContext.playerService;
    if (!service) {
        displayError(
            "Local player not initialized. Enable it with: @config localPlayer on",
            context,
        );
        return undefined;
    }
    return service;
}

// Status command handler
class StatusCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show local player status";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const state = service.getState();

        if (state.currentTrack) {
            const status = state.isPlaying
                ? "▶️ Playing"
                : state.isPaused
                  ? "⏸️ Paused"
                  : "⏹️ Stopped";
            displaySuccess(
                `${status}: ${state.currentTrack.name}\n` +
                    `Volume: ${state.volume}%${state.isMuted ? " (muted)" : ""}\n` +
                    `Shuffle: ${state.shuffle ? "On" : "Off"} | Repeat: ${state.repeat}\n` +
                    `Queue: ${state.currentIndex + 1}/${state.queue.length} tracks`,
                context,
            );
        } else {
            displayWarn(
                "No track loaded. Use '@localPlayer play' to start.",
                context,
            );
        }
    }
}

// Play command handler with optional file parameter
const playParameters = {
    args: {
        file: {
            description:
                "File name or path to play (optional - plays first file if not specified)",
            optional: true,
        },
    },
} as const;

const playHandler: CommandHandler = {
    description: "Play an audio file or resume playback",
    parameters: playParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof playParameters>,
    ) => {
        const service = getService(context);
        if (!service) return;

        const fileName = params.args.file;

        if (fileName) {
            const success = await service.playFile(fileName);
            if (success) {
                const state = service.getState();
                displaySuccess(
                    `▶️ Playing: ${state.currentTrack?.name}`,
                    context,
                );
            } else {
                displayError(`Could not find or play: ${fileName}`, context);
            }
        } else {
            // Resume or play first file
            const state = service.getState();
            if (state.isPaused) {
                service.resume();
                displaySuccess(
                    `▶️ Resumed: ${state.currentTrack?.name}`,
                    context,
                );
            } else if (state.queue.length > 0) {
                await service.playFromQueue(state.currentIndex + 1);
                displaySuccess(
                    `▶️ Playing: ${service.getState().currentTrack?.name}`,
                    context,
                );
            } else {
                // Play first file from folder
                const success = await service.playFolder();
                if (success) {
                    displaySuccess(
                        `▶️ Playing: ${service.getState().currentTrack?.name}`,
                        context,
                    );
                } else {
                    displayWarn(
                        "No audio files found. Set music folder with: @localPlayer setfolder <path>",
                        context,
                    );
                }
            }
        }
    },
};

// Pause command
class PauseCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Pause playback";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        service.pause();
        displaySuccess("⏸️ Paused", context);
    }
}

// Resume command
class ResumeCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Resume playback";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        service.resume();
        const state = service.getState();
        displaySuccess(
            `▶️ Resumed: ${state.currentTrack?.name || ""}`,
            context,
        );
    }
}

// Stop command
class StopCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Stop playback";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        service.stop();
        displaySuccess("⏹️ Stopped", context);
    }
}

// Next command
class NextCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Play next track";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const success = await service.next();
        if (success) {
            const state = service.getState();
            displaySuccess(`⏭️ Next: ${state.currentTrack?.name}`, context);
        } else {
            displayWarn("No next track available", context);
        }
    }
}

// Previous command
class PrevCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Play previous track";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const success = await service.previous();
        if (success) {
            const state = service.getState();
            displaySuccess(`⏮️ Previous: ${state.currentTrack?.name}`, context);
        } else {
            displayWarn("No previous track available", context);
        }
    }
}

// Folder command - show current folder
class FolderCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show current music folder";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const folder = service.getMusicFolder();
        displayStatus(`📁 Music folder: ${folder}`, context);
    }
}

// Set folder command with parameter
const setFolderParameters = {
    args: {
        path: {
            description: "Path to the music folder",
        },
    },
} as const;

const setFolderHandler: CommandHandler = {
    description: "Set the music folder path",
    parameters: setFolderParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof setFolderParameters>,
    ) => {
        const service = getService(context);
        if (!service) return;

        const folderPath = params.args.path;
        const success = service.setMusicFolder(folderPath);

        if (success) {
            // Persist the music folder setting
            const storage = context.sessionContext.agentContext.storage;
            if (storage) {
                const settings = await loadSettings(storage);
                settings.musicFolder = folderPath;
                await saveSettings(storage, settings);
            }

            const files = service.listFiles();
            displaySuccess(
                `📁 Music folder set to: ${folderPath}\nFound ${files.length} audio files`,
                context,
            );
        } else {
            displayError(`Invalid folder path: ${folderPath}`, context);
        }
    },
};

// List command
class ListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List audio files in music folder";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const files = service.listFiles();

        if (files.length === 0) {
            displayWarn("No audio files found in music folder", context);
            return;
        }

        const fileList = files
            .slice(0, 20)
            .map((f, i) => `${i + 1}. ${f.name}`)
            .join("\n");

        let message = `🎵 Found ${files.length} audio files:\n${fileList}`;
        if (files.length > 20) {
            message += `\n...and ${files.length - 20} more`;
        }

        displaySuccess(message, context);
    }
}

// Queue command
class QueueCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show playback queue";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const queue = service.getQueue();
        const state = service.getState();

        if (queue.length === 0) {
            displayWarn("Queue is empty", context);
            return;
        }

        const queueList = queue
            .slice(0, 20)
            .map((track, i) => {
                const current = i === state.currentIndex ? " ▶️" : "";
                return `${i + 1}. ${track.name}${current}`;
            })
            .join("\n");

        let message = `📋 Queue (${queue.length} tracks):\n${queueList}`;
        if (queue.length > 20) {
            message += `\n...and ${queue.length - 20} more`;
        }

        displaySuccess(message, context);
    }
}

// Clear command
class ClearCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Clear playback queue";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        service.clearQueue();
        displaySuccess("🗑️ Queue cleared", context);
    }
}

// Shuffle command
class ShuffleCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Toggle shuffle mode";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const state = service.getState();
        service.setShuffle(!state.shuffle);
        displaySuccess(`🔀 Shuffle: ${!state.shuffle ? "On" : "Off"}`, context);
    }
}

// Volume command with parameter
const volumeParameters = {
    args: {
        level: {
            description: "Volume level (0-100)",
        },
    },
} as const;

const volumeHandler: CommandHandler = {
    description: "Set volume level (0-100)",
    parameters: volumeParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof volumeParameters>,
    ) => {
        const service = getService(context);
        if (!service) return;

        const level = parseInt(params.args.level, 10);
        if (isNaN(level) || level < 0 || level > 100) {
            displayError("Volume must be a number between 0 and 100", context);
            return;
        }

        service.setVolume(level);
        displaySuccess(`🔊 Volume: ${level}%`, context);
    },
};

// Mute command
class MuteCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Toggle mute";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        const service = getService(context);
        if (!service) return;

        const state = service.getState();
        if (state.isMuted) {
            service.unmute();
            displaySuccess(`🔊 Unmuted (Volume: ${state.volume}%)`, context);
        } else {
            service.mute();
            displaySuccess("🔇 Muted", context);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Local music player commands",
    defaultSubCommand: "status",
    commands: {
        status: new StatusCommandHandler(),
        play: playHandler,
        pause: new PauseCommandHandler(),
        resume: new ResumeCommandHandler(),
        stop: new StopCommandHandler(),
        next: new NextCommandHandler(),
        prev: new PrevCommandHandler(),
        folder: new FolderCommandHandler(),
        setfolder: setFolderHandler,
        list: new ListCommandHandler(),
        queue: new QueueCommandHandler(),
        clear: new ClearCommandHandler(),
        shuffle: new ShuffleCommandHandler(),
        volume: volumeHandler,
        mute: new MuteCommandHandler(),
    },
};

export function getLocalPlayerCommandInterface(): AppAgentCommandInterface {
    return getCommandInterface(handlers);
}
