// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type LocalPlayerActions =
    | PlayFileAction
    | PlayFolderAction
    | PlayFromQueueAction
    | StatusAction
    | PauseAction
    | ResumeAction
    | StopAction
    | NextAction
    | PreviousAction
    | ShuffleAction
    | RepeatAction
    | SetVolumeAction
    | ChangeVolumeAction
    | MuteAction
    | UnmuteAction
    | ListFilesAction
    | SearchFilesAction
    | AddToQueueAction
    | ClearQueueAction
    | ShowQueueAction
    | SetMusicFolderAction
    | ShowMusicFolderAction;

export type LocalPlayerEntities = FilePath;
export type FilePath = string;

// Play a specific audio file by path or name
export interface PlayFileAction {
    actionName: "playFile";
    parameters: {
        // File name or path to play (can be partial match)
        fileName: string;
    };
}

// Play all audio files in a folder
export interface PlayFolderAction {
    actionName: "playFolder";
    parameters: {
        // Folder path to play from
        folderPath?: string;
        // Whether to shuffle the tracks
        shuffle?: boolean;
    };
}

// Play a specific track from the current queue by index
export interface PlayFromQueueAction {
    actionName: "playFromQueue";
    parameters: {
        // 1-based index of the track in the queue
        trackNumber: number;
    };
}

// Show now playing status including track information and playback state
export interface StatusAction {
    actionName: "status";
}

// Pause playback
export interface PauseAction {
    actionName: "pause";
}

// Resume playback
export interface ResumeAction {
    actionName: "resume";
}

// Stop playback completely
export interface StopAction {
    actionName: "stop";
}

// Skip to next track
export interface NextAction {
    actionName: "next";
}

// Go to previous track
export interface PreviousAction {
    actionName: "previous";
}

// Turn shuffle on or off
export interface ShuffleAction {
    actionName: "shuffle";
    parameters: {
        on: boolean;
    };
}

// Set repeat mode
export interface RepeatAction {
    actionName: "repeat";
    parameters: {
        // Repeat mode: "off", "one" (repeat current track), "all" (repeat queue)
        mode: "off" | "one" | "all";
    };
}

// Set volume to a specific level (0-100)
export interface SetVolumeAction {
    actionName: "setVolume";
    parameters: {
        // New volume level (0-100)
        level: number;
    };
}

// Change volume by a relative amount
export interface ChangeVolumeAction {
    actionName: "changeVolume";
    parameters: {
        // Amount to change volume by (can be negative)
        amount: number;
    };
}

// Mute audio
export interface MuteAction {
    actionName: "mute";
}

// Unmute audio
export interface UnmuteAction {
    actionName: "unmute";
}

// List audio files in the music folder or a specified folder
export interface ListFilesAction {
    actionName: "listFiles";
    parameters?: {
        // Folder to list (defaults to music folder)
        folderPath?: string;
    };
}

// Search for audio files by name
export interface SearchFilesAction {
    actionName: "searchFiles";
    parameters: {
        // Search query to match against file names
        query: string;
    };
}

// Add a file or files to the playback queue
export interface AddToQueueAction {
    actionName: "addToQueue";
    parameters: {
        // File name or path to add to queue
        fileName: string;
    };
}

// Clear the playback queue
export interface ClearQueueAction {
    actionName: "clearQueue";
}

// Show the current playback queue
export interface ShowQueueAction {
    actionName: "showQueue";
}

// Set the default music folder path
export interface SetMusicFolderAction {
    actionName: "setMusicFolder";
    parameters: {
        // Path to the music folder
        folderPath: FilePath;
    };
}

// Show the current music folder path
export interface ShowMusicFolderAction {
    actionName: "showMusicFolder";
}
