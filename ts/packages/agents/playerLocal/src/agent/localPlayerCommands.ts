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
import { displayError } from "@typeagent/agent-sdk/helpers/display";
import {
    LocalPlayerActionContext,
    executeLocalPlayerAction,
} from "./localPlayerHandlers.js";

// Status command handler
class StatusCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show local player status";
    public readonly action = "status";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "status" },
            context,
        );
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
    action: "play",
    parameters: playParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof playParameters>,
    ) => {
        return executeLocalPlayerAction(
            {
                schemaName: "localPlayer",
                actionName: "play",
                ...(params.args.file === undefined
                    ? {}
                    : { parameters: { fileName: params.args.file } }),
            },
            context,
        );
    },
};

// Pause command
class PauseCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Pause playback";
    public readonly action = "pause";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "pause" },
            context,
        );
    }
}

// Resume command
class ResumeCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Resume playback";
    public readonly action = "resume";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "resume" },
            context,
        );
    }
}

// Stop command
class StopCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Stop playback";
    public readonly action = "stop";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "stop" },
            context,
        );
    }
}

// Next command
class NextCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Play next track";
    public readonly action = "next";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "next" },
            context,
        );
    }
}

// Previous command
class PrevCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Play previous track";
    public readonly action = "previous";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "previous" },
            context,
        );
    }
}

// Folder command - show current folder
class FolderCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show current music folder";
    public readonly action = "showMusicFolder";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "showMusicFolder" },
            context,
        );
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
    action: "setMusicFolder",
    parameters: setFolderParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof setFolderParameters>,
    ) => {
        return executeLocalPlayerAction(
            {
                schemaName: "localPlayer",
                actionName: "setMusicFolder",
                parameters: { folderPath: params.args.path },
            },
            context,
        );
    },
};

// List command
class ListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List audio files in music folder";
    public readonly action = "listFiles";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "listFiles" },
            context,
        );
    }
}

// Queue command
class QueueCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show playback queue";
    public readonly action = "showQueue";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "showQueue" },
            context,
        );
    }
}

// Clear command
class ClearCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Clear playback queue";
    public readonly action = "clearQueue";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "clearQueue" },
            context,
        );
    }
}

// Shuffle command
class ShuffleCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Toggle shuffle mode";
    public readonly action = "toggleShuffle";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "toggleShuffle" },
            context,
        );
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
    action: "setVolume",
    parameters: volumeParameters,
    run: async (
        context: ActionContext<LocalPlayerActionContext>,
        params: ParsedCommandParams<typeof volumeParameters>,
    ) => {
        const level = parseInt(params.args.level, 10);
        if (isNaN(level) || level < 0 || level > 100) {
            displayError("Volume must be a number between 0 and 100", context);
            return;
        }

        return executeLocalPlayerAction(
            {
                schemaName: "localPlayer",
                actionName: "setVolume",
                parameters: { level },
            },
            context,
        );
    },
};

// Mute command
class MuteCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Toggle mute";
    public readonly action = "toggleMute";

    public async run(context: ActionContext<LocalPlayerActionContext>) {
        return executeLocalPlayerAction(
            { schemaName: "localPlayer", actionName: "toggleMute" },
            context,
        );
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
