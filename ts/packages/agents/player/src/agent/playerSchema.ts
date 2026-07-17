// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PlayerActions =
    | PlayMusicAction
    | FindMusicAction
    | PlayFromCurrentTrackListAction
    | StatusAction
    | PauseAction
    | ResumePlaybackAction
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
    | ListPlaylistsAction
    | GetPlaylistAction
    | GetFromCurrentPlaylistListAction
    | GetAlbumAction
    | GetFavoritesAction
    | CreatePlaylistAction
    | DeletePlaylistAction
    | AddCurrentTrackToPlaylistAction
    | AddToPlaylistFromCurrentTrackListAction
    | AddSongsToPlaylistAction
    | GetQueueAction
    | PlayPlaylistAction;

export type PlayerEntities = MusicDevice;
export type MusicDevice = string;

// Specification for a song by title and optional artist/album
export interface SongSpecification {
    trackName: string;
    artist?: string;
    albumName?: string;
}

// Start playing music now. Use this when the user wants to play / put on /
// start / listen to music — a specific song, artist, album, genre, a free-form
// description (e.g. "chill music for studying"), or just "some music". To
// search for or browse music WITHOUT starting playback, use FindMusicAction.
export interface PlayMusicAction {
    actionName: "playMusic";
    parameters: {
        // What music to select. Pick the ONE variant that best matches what the
        // user named. If it isn't clearly one artist / album / genre, use
        // { kind: "description" } with the user's own words as the query.
        target: MusicTarget;
        // number of tracks when the user asks for a specific amount
        quantity?: number;
    };
}

// Find / search for / look up music and show it as the current track list
// WITHOUT starting playback. Use this for "find", "look for", "search for",
// "show me" music — a specific song, artist, album, genre, a free-form
// description (e.g. "the best guitar solos"), or playlists. To start playing
// immediately instead, use PlayMusicAction.
export interface FindMusicAction {
    actionName: "findMusic";
    parameters: {
        // What music to look for. Same choices as PlayMusicAction's target.
        target: MusicTarget;
        // Set true ONLY when the user asks to find something AND play it in the
        // same breath (e.g. "find some Bach and play it"). Leave unset for a
        // plain search / "show me".
        play?: boolean;
        // number of tracks when the user asks for a specific amount
        quantity?: number;
    };
}

// The selection criteria for PlayMusicAction / FindMusicAction. Exactly one kind.
export type MusicTarget =
    | PlayByTrack
    | PlayByArtist
    | PlayByAlbum
    | PlayByGenre
    | PlayByPlaylist
    | PlayByDescription
    | PlayAnyMusic;

// a specific named song, optionally by a given artist and/or on a given album
export interface PlayByTrack {
    kind: "track";
    trackName: string;
    artists?: string[];
    albumName?: string;
}

// all / top tracks of a specific artist, optionally narrowed to a genre
export interface PlayByArtist {
    kind: "artist";
    artist: string;
    genre?: string;
}

// a specific album, optionally by given artist(s)
export interface PlayByAlbum {
    kind: "album";
    albumName: string;
    artists?: string[];
}

// a musical genre or style, e.g. "jazz", "lo-fi hip hop", "chillout"
export interface PlayByGenre {
    kind: "genre";
    genre: string;
}

// search for playlists that match a phrase, e.g. "workout", "jazz for dinner",
// "party anthems". Usually reached via FindMusicAction to browse matching
// playlists rather than individual tracks. To play a playlist the user has
// already named, use PlayPlaylistAction instead.
export interface PlayByPlaylist {
    kind: "playlist";
    query: string;
}

// a free-form description that is not a single clean artist / album / genre,
// e.g. "music to sing in the shower", "party anthems for a night out", "the
// most iconic guitar solos". Put the user's descriptive words in `query`.
export interface PlayByDescription {
    kind: "description";
    query: string;
}

// the user just wants some music / anything, with no particular criteria
export interface PlayAnyMusic {
    kind: "any";
}

// play the track single track at index 'trackNumber' in the current track list
// report if there is no current track list
export interface PlayFromCurrentTrackListAction {
    actionName: "playFromCurrentTrackList";
    parameters: {
        trackNumber: number;
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

// Resume or continue playback of the current track after it was paused or
// stopped. This simply un-pauses and keeps the current music going; it does not
// select a new song, so no specific song needs to be identified.
export interface ResumePlaybackAction {
    actionName: "resumePlayback";
}

// next track
export interface NextAction {
    actionName: "next";
}

// previous track
// User: play the last song again
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

// create a new playlist, optionally with a list of songs specified by title and artist
export interface CreatePlaylistAction {
    actionName: "createPlaylist";
    parameters: {
        // name of playlist to create
        name: string;
        // optional list of songs to add to the playlist when creating it
        songs?: SongSpecification[];
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
        name: string;
    };
}

// add to the named playlist one or more tracks starting at index 'trackNumber' in the current track list
export interface AddToPlaylistFromCurrentTrackListAction {
    actionName: "addToPlaylistFromCurrentTrackList";
    parameters: {
        // name of playlist to add the track to
        name: string;
        // 1-based index of the first track to add
        trackNumber: number;
        // number of tracks to add (default 1)
        // if specified, adds this many tracks starting from trackNumber; for example, to add tracks 3,4,5 set trackNumber=3 and trackCount=3
        trackCount?: number;
    };
}

// add songs to a playlist by specifying track names and optional artists
// this action searches for each song and adds it to the playlist
export interface AddSongsToPlaylistAction {
    actionName: "addSongsToPlaylist";
    parameters: {
        // name of playlist to add songs to
        name: string;
        // list of songs to add, each specified by track name and optional artist/album
        songs: SongSpecification[];
    };
}

// set the current track list to the queue of upcoming tracks
export interface GetQueueAction {
    actionName: "getQueue";
}

// play the named play list
export interface PlayPlaylistAction {
    actionName: "playPlaylist";
    parameters: {
        // name of playlist to play
        name: string;
    };
}
