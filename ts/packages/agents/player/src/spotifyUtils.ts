// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getAlbumString(album: SpotifyApi.AlbumObjectSimplified) {
    return `${album.name} by ${album.artists[0].name}`;
}

export function toTrackObjectFull(
    track: SpotifyApi.TrackObjectSimplified,
    album: SpotifyApi.AlbumObjectSimplified,
): SpotifyApi.TrackObjectFull {
    return {
        ...track,
        album,
        external_ids: {},
        popularity: 0,
    };
}
