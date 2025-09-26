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

function toAlbumObjectSimplified(
    albumRec: SpotifyApi.RecommendationAlbumObject,
): SpotifyApi.AlbumObjectSimplified {
    return {
        ...albumRec,
        album_type: "album",
        href: "",
        id: albumRec.id,
        images: [],
        release_date: "",
        release_date_precision: "day",
        total_tracks: 0,
        uri: albumRec.uri,
    };
}
export class TrackCollection implements ITrackCollection {
    constructor(
        private readonly tracks: SpotifyApi.TrackObjectFull[],
        private readonly contextUri?: string,
    ) {}

    static fromRecommendationTracks(
        recommendations: SpotifyApi.RecommendationTrackObject[],
    ) {
        return new TrackCollection(
            recommendations.map((track) =>
                toTrackObjectFull(track, toAlbumObjectSimplified(track.album)),
            ),
            undefined,
        );
    }

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
