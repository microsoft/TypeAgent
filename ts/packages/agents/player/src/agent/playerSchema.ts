// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PlayerAction =
    | PlayRandomAction
    | PlayTrackAction
    | PlayAlbumAction
    | PlayAlbumTrackAction
    | PlayArtistAction
    | PlayGenreAction
    | StatusAction
    | PauseAction
    | ResumeAction
    | NextAction
    | PreviousAction
    | ShuffleAction
    | ListDevicesAction
    | SelectDeviceAction
    | SetVolumeAction
    | ChangeVolumeAction
    | SearchTracksAction
    | ListPlaylistsAction
    | GetPlaylistAction
    | GetAlbumAction
    | GetFavoritesAction
    | FilterTracksAction
    | CreatePlaylistAction
    | DeletePlaylistAction
    | GetQueueAction
    | UnknownAction;

// Use playRandom when the user asks for some music to play
export interface PlayRandomAction {
    actionName: "playRandom";
    parameters: {
        quantity?: number;
    };
}

export interface PlayTrackAction {
    actionName: "playTrack";
    parameters: {
        trackName: string;
        artists?: string[];
    };
}

export interface PlayAlbumAction {
    actionName: "playAlbum";
    parameters: {
        albumName: string;
        artists?: string[];
        trackNumber?: number[];
    };
}

export interface PlayAlbumTrackAction {
    actionName: "playAlbumTrack";
    parameters: {
        albumName: string;
        trackName: string;
        artists?: string[];
    };
}

export interface PlayArtistAction {
    actionName: "playArtist";
    parameters: {
        artist: string;
        quantity?: number;
    };
}

export interface PlayGenreAction {
    actionName: "playGenre";
    parameters: {
        genre: string;
        quantity?: number;
    };
}

// show now playing including track information, and playback status including playback device
export interface StatusAction {
    actionName: "status";
    parameters: {};
}

// pause playback
export interface PauseAction {
    actionName: "pause";
    parameters: {};
}

// resume playback
export interface ResumeAction {
    actionName: "resume";
    parameters: {};
}

// next track
export interface NextAction {
    actionName: "next";
    parameters: {};
}

// previous track
export interface PreviousAction {
    actionName: "previous";
    parameters: {};
}

// turn shuffle on or off
export interface ShuffleAction {
    actionName: "shuffle";
    parameters: { on: boolean };
}

// list available playback devices
export interface ListDevicesAction {
    actionName: "listDevices";
    parameters: {};
}

// select playback device by keyword
export interface SelectDeviceAction {
    actionName: "selectDevice";
    parameters: {
        // keyword to match against device name
        keyword: string;
    };
}

// set volume
export interface SetVolumeAction {
    actionName: "setVolume";
    parameters: {
        // new volume level
        newVolumeLevel: number;
    };
}

// change volume plus or minus a specified percentage
export interface ChangeVolumeAction {
    actionName: "changeVolume";
    parameters: {
        // volume change percentage
        volumeChangePercentage: number;
    };
}

// this action is only used when the user asks for a search as in 'search', 'find', 'look for'
// query is a Spotify search expression such as 'Rock Lobster' or 'te kanawa queen of night'
// set the current track list to the result of the search
export interface SearchTracksAction {
    actionName: "searchTracks";
    parameters: {
        // the part of the request specifying the the search keywords
        // examples: song name, album name, artist name
        query: string;
    };
}

// list all playlists
export interface ListPlaylistsAction {
    actionName: "listPlaylists";
    parameters: {};
}

// get playlist by name
export interface GetPlaylistAction {
    actionName: "getPlaylist";
    parameters: {
        // name of playlist to get
        name: string;
    };
}

// get album by name; if name is "", use the currently playing track
// set the current track list the tracks in the album
export interface GetAlbumAction {
    actionName: "getAlbum";
    parameters: {
        // name of album to get
        name: string;
    };
}

// Set the current track list to the user's favorite tracks
export interface GetFavoritesAction {
    actionName: "getFavorites";
    parameters: {
        // number of favorites to get
        count?: number;
    };
}

// apply a filter to match tracks in the current track list
// set the current track list to the tracks that match the filter
export interface FilterTracksAction {
    actionName: "filterTracks";
    parameters: {
        // filter type is one of "genre", "artist", "name"; name does a fuzzy match on the track name
        filterType: "genre" | "artist" | "name";
        // filter value is the value to match against
        filterValue: string;
        // if negate is true, keep the tracks that do not match the filter
        negate?: boolean;
    };
}

// create a new playlist from the current track list
export interface CreatePlaylistAction {
    actionName: "createPlaylist";
    parameters: {
        // name of playlist to create
        name: string;
    };
}

// delete a playlist
export interface DeletePlaylistAction {
    actionName: "deletePlaylist";
    parameters: {
        // name of playlist to delete
        name: string;
    };
}

// set the current track list to the queue of upcoming tracks
export interface GetQueueAction {
    actionName: "getQueue";
    parameters: {};
}

// use this action for requests that weren't understood
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}
