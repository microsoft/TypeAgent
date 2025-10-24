// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PlayerActions =
    | PlayRandomAction
    | PlayTrackAction
    | PlayFromCurrentTrackListAction
    | PlayAlbumAction
    | PlayArtistAction
    | PlayGenreAction
    | StatusAction
    | PauseAction
    | ResumeAction
    | NextAction
    | PreviousAction
    | ShuffleAction
    | ListDevicesAction
    | SetDefaultDeviceAction
    | SelectDeviceAction
    | ShowSelectedDeviceAction
    | SetVolumeAction
    | SetMaxVolumeAction
    | ChangeVolumeAction
    | SearchTracksAction
    | SearchForPlaylistsAction
    | ListPlaylistsAction
    | GetPlaylistAction
    | GetFromCurrentPlaylistListAction
    | GetAlbumAction
    | GetFavoritesAction
    | FilterTracksAction
    | CreatePlaylistAction
    | DeletePlaylistAction
    | AddCurrentTrackToPlaylistAction
    | AddToPlaylistFromCurrentTrackListAction
    | GetQueueAction;

export type PlayerEntities = MusicDevice;
export type MusicDevice = string;

// Use playRandom when the user asks for some music to play
export interface PlayRandomAction {
    actionName: "playRandom";
    parameters?: {
        quantity?: number;
    };
}

// Play a specific track
export interface PlayTrackAction {
    actionName: "playTrack";
    parameters: {
        trackName: string;
        albumName?: string;
        artists?: string[];
    };
}

// Play a specific album
export interface PlayAlbumAction {
    actionName: "playAlbum";
    parameters: {
        albumName: string;
        artists?: string[];
        trackNumber?: number[];
    };
}

// play the track single track at index 'trackNumber' in the current track list
// report if there is no current track list
export interface PlayFromCurrentTrackListAction {
    actionName: "playFromCurrentTrackList";
    parameters: {
        trackNumber: number;
    };
}

export interface PlayArtistAction {
    actionName: "playArtist";
    parameters: {
        artist: string;
        genre?: string; // option genre if specified.
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
}

// pause playback
export interface PauseAction {
    actionName: "pause";
}

// resume playback
export interface ResumeAction {
    actionName: "resume";
}

// next track
export interface NextAction {
    actionName: "next";
}

// previous track
export interface PreviousAction {
    actionName: "previous";
}

// turn shuffle on or off
export interface ShuffleAction {
    actionName: "shuffle";
    parameters: { on: boolean };
}

// list available playback devices
export interface ListDevicesAction {
    actionName: "listDevices";
}

export interface SetDefaultDeviceAction {
    actionName: "setDefaultDevice";
    parameters: {
        // device name.  If not specified, the current selected device is set as the default.
        deviceName?: MusicDevice;
    };
}

// select playback device by keyword
export interface SelectDeviceAction {
    actionName: "selectDevice";
    parameters: {
        // device name such as "bedroom", "living room", "whole house", "office computer", etc.
        deviceName: MusicDevice;
    };
}

// show the selected playback device
export interface ShowSelectedDeviceAction {
    actionName: "showSelectedDevice";
}

// set volume
export interface SetVolumeAction {
    actionName: "setVolume";
    parameters: {
        // new volume level
        newVolumeLevel: number;
    };
}

// set max volume for the current device
export interface SetMaxVolumeAction {
    actionName: "setMaxVolume";
    parameters: {
        // new volume level
        newMaxVolumeLevel: number;
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

// this action is used when the user asks to search for public playlists that match a query string like 'search playlist bach hilary hahn'; it is not used to get a specific playlist by name (use GetPlaylistAction for that); it is not used to search for tracks (use SearchTracksAction for that)
// result of this action is a list of playlists that match the query
export interface SearchForPlaylistsAction {
    actionName: "searchForPlaylists";
    parameters: {
        // the part of the request specifying the the search keywords
        // examples: 'bach hilary hahn', 'rock classics', 'workout', 'jazz for dinner'
        query: string;
    };
}
// list all playlists
export interface ListPlaylistsAction {
    actionName: "listPlaylists";
}

// get playlist by name
export interface GetPlaylistAction {
    actionName: "getPlaylist";
    parameters: {
        // name of playlist to get
        name: string;
    };
}

export interface GetFromCurrentPlaylistListAction {
    actionName: "getFromCurrentPlaylistList";
    parameters: {
        // 1-base index of playlist in the current playlist list to get
        playlistNumber: number;
    };
}

// get currently playing album
// set the current track list the tracks in the album
export interface GetAlbumAction {
    actionName: "getAlbum";
}

// result of this action is an entity of type 'track-list' with the user's favorites
export interface GetFavoritesAction {
    actionName: "getFavorites";
    parameters?: {
        // number of favorites to get
        count?: number;
    };
}

// apply a filter to match tracks in the track list given by the entity id
// result of this action is an entity of type 'track-list' with the tracks that match the filter
export interface FilterTracksAction {
    actionName: "filterTracks";
    parameters: {
        // track list entity to use as the source of tracks
        trackListEntityId: string;
        // filter type is one of "genre", "artist", "name"; name does a fuzzy match on the track name
        filterType: "genre" | "artist" | "name";
        // filter value is the value to match against
        filterValue: string;
        // if negate is true, keep the tracks that do not match the filter
        negate?: boolean;
    };
}

// create a new playlist from a track list entity
export interface CreatePlaylistAction {
    actionName: "createPlaylist";
    parameters: {
        // name of playlist to create
        name: string;
        // track list entity to use as the source of tracks
        trackListEntityId?: string;
        // if true, create an empty playlist
        empty?: boolean;
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

// add the currently playing track to a playlist
export interface AddCurrentTrackToPlaylistAction {
    actionName: "addCurrentTrackToPlaylist";
    parameters: {
        // name of playlist to add the current track to
        playlistName: string;
    };
}

// add to the named playlist one or more tracks starting at index 'trackNumber' in the current track list
export interface AddToPlaylistFromCurrentTrackListAction {
    actionName: "addToPlaylistFromCurrentTrackList";
    parameters: {
        // name of playlist to add the track to
        playlistName: string;
        // 1-based index of the first track to add
        trackNumber: number;
        // number of tracks to add (default 1)
        // if specified, adds this many tracks starting from trackNumber; for example, to add tracks 3,4,5 set trackNumber=3 and trackCount=3
        trackCount?: number;
    };
}

// set the current track list to the queue of upcoming tracks
export interface GetQueueAction {
    actionName: "getQueue";
}
