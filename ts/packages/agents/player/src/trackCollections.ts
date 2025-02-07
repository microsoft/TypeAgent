// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { toTrackObjectFull } from "./spotifyUtils.js";

// for now, no paging of track lists; later add offset and count
export interface ITrackCollection {
    getTrackCount(): number;
    getTracks(): SpotifyApi.TrackObjectFull[];
    getContext(): string | undefined;
    getPlaylist(): SpotifyApi.PlaylistObjectSimplified | undefined;
    copy(): ITrackCollection;
}

export class TrackCollection implements ITrackCollection {
    constructor(
        private readonly tracks: SpotifyApi.TrackObjectFull[],
        private readonly contextUri?: string,
    ) {}

    getTracks() {
        return this.tracks;
    }
    getContext() {
        return this.contextUri;
    }

    getTrackCount(): number {
        return this.tracks.length;
    }

    getPlaylist(): SpotifyApi.PlaylistObjectSimplified | undefined {
        return undefined;
    }

    copy() {
        return new TrackCollection(this.tracks, this.contextUri);
    }
}

export class PlaylistTrackCollection extends TrackCollection {
    constructor(
        public playlist: SpotifyApi.PlaylistObjectSimplified,
        tracks: SpotifyApi.TrackObjectFull[],
    ) {
        super(tracks, playlist.uri);
    }

    getPlaylist() {
        return this.playlist;
    }

    copy() {
        return new PlaylistTrackCollection(this.playlist, this.getTracks());
    }
}

export class AlbumTrackCollection extends TrackCollection {
    constructor(public album: SpotifyApi.AlbumObjectFull) {
        super(
            album.tracks.items.map((albumItem) =>
                toTrackObjectFull(albumItem, album),
            ),
            album.uri,
        );
    }
    copy() {
        return new AlbumTrackCollection(this.album);
    }
}
