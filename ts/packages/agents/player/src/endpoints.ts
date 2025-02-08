// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import axios from "axios";
import { translateAxiosError, translateAxiosErrorNoThrow } from "./utils.js";
import { SpotifyService } from "./service.js";
import registerDebug from "debug";

const debugSpotifyRest = registerDebug("typeagent:spotify:rest");

export const limitMax = 50;

export async function search(
    query: SpotifyApi.SearchForItemParameterObject,
    service: SpotifyService,
) {
    debugSpotifyRest("search", query);
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getClientCredentials()}`,
        },
    };

    const searchUrl = getUrlWithParams(
        "https://api.spotify.com/v1/search",
        query,
    );
    try {
        const spotifyResult = await axios.get(searchUrl, config);
        debugSpotifyRest("search success");
        return spotifyResult.data as SpotifyApi.SearchResponse;
    } catch (e) {
        debugSpotifyRest("search failed");
        translateAxiosError(e);
    }
    return undefined;
}

async function getK<T>(
    k: number,
    get: (
        count: number,
        offset: number,
    ) => Promise<SpotifyApi.PagingObject<T> | undefined>,
): Promise<T[] | undefined> {
    let data = await get(Math.min(k, limitMax), 0);
    if (!data || data.items.length === 0) {
        return undefined;
    }
    const results = data.items;
    if (k <= limitMax) {
        return results;
    }
    while (results.length < k) {
        const offset = results.length;
        if (offset >= data.total) {
            break;
        }
        data = await get(Math.min(k - results.length, limitMax), offset);
        if (!data || data.items.length === 0) {
            return undefined;
        }
        results.push(...data.items);
    }
    return results;
}

async function callRestAPI<T>(
    service: SpotifyService,
    restUrl: string,
    params: Record<string, any>,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const url = getUrlWithParams(restUrl, params);
    try {
        const spotifyResult = await axios.get(url, config);
        debugSpotifyRest(`${restUrl}`, spotifyResult.data);
        return spotifyResult.data as T;
    } catch (e) {
        translateAxiosError(e, url);
    }
    return undefined;
}

export async function getFavoriteAlbums(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, offset: number) =>
        callRestAPI<SpotifyApi.UsersSavedAlbumsResponse>(
            service,
            "https://api.spotify.com/v1/me/albums",
            {
                limit,
                offset,
            },
        );
    return getK(k, get);
}

export async function getFavoriteTracks(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, offset: number) =>
        callRestAPI<SpotifyApi.UsersSavedTracksResponse>(
            service,
            "https://api.spotify.com/v1/me/tracks",
            {
                limit,
                offset,
            },
        );
    return getK(k, get);
}

export async function getTopUserArtists(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, offset: number) =>
        callRestAPI<SpotifyApi.UsersTopArtistsResponse>(
            service,
            "https://api.spotify.com/v1/me/top/artists",
            {
                limit,
                offset,
            },
        );
    return getK(k, get);
}

export async function getTopUserTracks(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, offset: number) =>
        callRestAPI<SpotifyApi.UsersTopTracksResponse>(
            service,
            "https://api.spotify.com/v1/me/top/tracks",
            {
                limit,
                offset,
            },
        );
    return getK(k, get);
}

async function getKCursor<T>(
    k: number,
    get: (
        count: number,
        after: string | undefined,
    ) => Promise<SpotifyApi.CursorBasedPagingObject<T> | undefined>,
): Promise<T[] | undefined> {
    let data = await get(Math.min(k, limitMax), undefined);
    if (!data || data.items.length === 0) {
        return undefined;
    }
    const results = data.items;
    if (k <= limitMax) {
        return results;
    }
    while (results.length < k) {
        const after = data.cursors.after;
        if (after === null) {
            break;
        }
        data = await get(Math.min(k - results.length, limitMax), after);
        if (!data || data.items.length === 0) {
            return undefined;
        }
        results.push(...data.items);
    }
    return results;
}

export async function getFollowedArtists(
    service: SpotifyService,
    k = limitMax,
) {
    const get = async (limit: number, after: string | undefined) => {
        const param: any = {
            type: "artist",
            limit,
        };
        if (after) {
            param.after = after;
        }
        const response =
            await callRestAPI<SpotifyApi.UsersFollowedArtistsResponse>(
                service,
                "https://api.spotify.com/v1/me/following",
                param,
            );
        return response?.artists;
    };

    return getKCursor(k, get);
}

export async function getRecentlyPlayed(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, after: string | undefined) =>
        callRestAPI<SpotifyApi.UsersRecentlyPlayedTracksResponse>(
            service,
            "https://api.spotify.com/v1/me/player/recently-played",
            after
                ? {
                      limit,
                      after,
                  }
                : { limit },
        );
    return getKCursor(limitMax, get);
}

export async function getArtist(service: SpotifyService, id: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const artistsUrl = `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`;

    try {
        const spotifyResult = await axios.get(artistsUrl, config);

        return spotifyResult.data as SpotifyApi.SingleArtistResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getArtists(service: SpotifyService, ids: string[]) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const artistsUrl = getUrlWithParams("https://api.spotify.com/v1/artists", {
        ids,
    });
    try {
        const spotifyResult = await axios.get(artistsUrl, config);

        return spotifyResult.data as SpotifyApi.MultipleArtistsResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getArtistTopTracks(service: SpotifyService, id: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const artistsUrl = `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}/top-tracks`;
    try {
        const spotifyResult = await axios.get(artistsUrl, config);
        return spotifyResult.data as SpotifyApi.ArtistsTopTracksResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getHistoryURL(service: SpotifyService, url: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    console.log(url);
    try {
        const spotifyResult = await axios.get(url, config);

        const spotData =
            spotifyResult.data as SpotifyApi.UsersRecentlyPlayedTracksResponse;
        return spotData;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getUserProfile(service: SpotifyService) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.get(
            "https://api.spotify.com/v1/me",
            config,
        );

        return spotifyResult.data as SpotifyApi.UserProfileResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getPlaybackState(service: SpotifyService) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.get(
            "https://api.spotify.com/v1/me/player",
            config,
        );

        return spotifyResult.data as SpotifyApi.CurrentPlaybackResponse;
    } catch (e) {
        const msg = translateAxiosErrorNoThrow(e);
        console.log(`getPlaybackState caught axios error: ${msg}`);
    }
    return undefined;
}

export async function transferPlayback(
    service: SpotifyService,
    deviceId: string,
    play = false,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    const xferUrl = "https://api.spotify.com/v1/me/player/";

    const params = { device_ids: [deviceId], play };
    try {
        const spotifyResult = await axios.put(xferUrl, params, config);

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function play(
    service: SpotifyService,
    deviceId: string,
    uris?: string[],
    contextUri?: string,
    trackNumber?: number,
    seekms?: number,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    const smallTrack: SpotifyApi.PlayParameterObject = {};
    if (contextUri) {
        smallTrack.context_uri = contextUri;
        if (trackNumber) {
            smallTrack.offset = { position: trackNumber };
            if (seekms) {
                smallTrack.position_ms = seekms;
            }
        }
    } else if (uris) {
        smallTrack.uris = uris;
    }
    const playUrl = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/play",
        { device_id: deviceId },
    );
    try {
        const spotifyResult = await axios.put(playUrl, smallTrack, config);

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getDevices(service: SpotifyService) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    try {
        const spotifyResult = await axios.get(
            "https://api.spotify.com/v1/me/player/devices",
            config,
        );

        return spotifyResult.data as SpotifyApi.UserDevicesResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function pause(service: SpotifyService, deviceId: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const pauseUrl = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/pause",
        { device_id: deviceId },
    );
    try {
        const spotifyResult = await axios.put(pauseUrl, {}, config);

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
}

export async function getQueue(service: SpotifyService) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.get(
            `https://api.spotify.com/v1/me/player/queue?limit=50`,
            config,
        );

        return spotifyResult.data as SpotifyApi.UsersQueueResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function previous(service: SpotifyService, deviceId: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.post(
            `https://api.spotify.com/v1/me/player/previous?device_id=${deviceId}`,
            {},
            config,
        );

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function shuffle(
    service: SpotifyService,
    deviceId: string,
    newShuffleState: boolean,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.put(
            `https://api.spotify.com/v1/me/player/shuffle?state=${newShuffleState}&device_id=${deviceId}`,
            {},
            config,
        );

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function next(service: SpotifyService, deviceId: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const spotifyResult = await axios.post(
            `https://api.spotify.com/v1/me/player/next?device_id=${deviceId}`,
            {},
            config,
        );

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getPlaylists(service: SpotifyService) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const getUri = "https://api.spotify.com/v1/me/playlists";
        const spotifyResult = await axios.get(getUri, config);

        return spotifyResult.data as SpotifyApi.ListOfCurrentUsersPlaylistsResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getAlbum(
    service: SpotifyService,
    id: string,
): Promise<SpotifyApi.SingleAlbumResponse | undefined> {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const albumUrl = `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`;
    try {
        const spotifyResult = await axios.get(albumUrl, config);
        return spotifyResult.data as SpotifyApi.SingleAlbumResponse;
    } catch (e) {
        translateAxiosError(e);
    }
}

export async function getAlbums(
    service: SpotifyService,
    ids: string[],
): Promise<SpotifyApi.MultipleAlbumsResponse | undefined> {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const artistsUrl = getUrlWithParams("https://api.spotify.com/v1/albums", {
        ids,
    });
    try {
        const spotifyResult = await axios.get(artistsUrl, config);
        return spotifyResult.data as SpotifyApi.MultipleAlbumsResponse;
    } catch (e) {
        translateAxiosError(e);
    }
}

export async function getAlbumTracks(service: SpotifyService, albumId: string) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const getUri = `https://api.spotify.com/v1/albums/${encodeURIComponent(
            albumId,
        )}/tracks`;
        const spotifyResult = await axios.get(getUri, config);

        return spotifyResult.data as SpotifyApi.AlbumTracksResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function getTrack(
    service: SpotifyService,
    id: string,
): Promise<SpotifyApi.SingleTrackResponse | undefined> {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const albumUrl = `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`;
    try {
        const spotifyResult = await axios.get(albumUrl, config);
        return spotifyResult.data as SpotifyApi.SingleTrackResponse;
    } catch (e) {
        translateAxiosError(e);
    }
}

export async function getTracksFromIdsBatch(
    service: SpotifyService,
    trackIds: string[],
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const getUri = `https://api.spotify.com/v1/tracks/?ids=${trackIds.join(
            ",",
        )}`;
        const spotifyResult = await axios.get(getUri, config);

        return spotifyResult.data as SpotifyApi.MultipleTracksResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

// get tracks from ids 100 ids at a time
export async function getTracksFromIds(
    service: SpotifyService,
    trackIds: string[],
) {
    const trackIdChunks = [];
    for (let i = 0; i < trackIds.length; i += 100) {
        trackIdChunks.push(trackIds.slice(i, i + 100));
    }
    const trackResponses = [];
    for (const chunk of trackIdChunks) {
        const response = await getTracksFromIdsBatch(service, chunk);
        if (response) {
            trackResponses.push(...response.tracks);
        }
    }
    return trackResponses;
}

export async function getPlaylistTracks(
    service: SpotifyService,
    playlistId: string,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const getUri = `https://api.spotify.com/v1/playlists/${encodeURIComponent(
            playlistId,
        )}/tracks`;
        const spotifyResult = await axios.get(getUri, config);

        return spotifyResult.data as SpotifyApi.PlaylistTrackResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function deletePlaylist(
    service: SpotifyService,
    playlistId: string,
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const deleteUri = `https://api.spotify.com/v1/playlists/${encodeURIComponent(
            playlistId,
        )}/followers`;
        const spotifyResult = await axios.delete(deleteUri, config);

        return spotifyResult.data as SpotifyApi.UnfollowPlaylistResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function createPlaylist(
    service: SpotifyService,
    name: string,
    userId: string,
    uris: string[],
    description = "",
) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };
    try {
        const createUri = `https://api.spotify.com/v1/users/${userId}/playlists`;
        const spotifyResult = await axios.post(
            createUri,
            { name, public: false, description },
            config,
        );
        const playlistResponse =
            spotifyResult.data as SpotifyApi.CreatePlaylistResponse;
        const addTracksResult = await axios.post(
            `https://api.spotify.com/v1/playlists/${playlistResponse.id}/tracks`,
            { uris },
            config,
        );
        return addTracksResult.data as SpotifyApi.AddTracksToPlaylistResponse;
    } catch (e) {
        translateAxiosError(e);
    }
    return undefined;
}

export async function setVolume(service: SpotifyService, amt = limitMax) {
    const config = {
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    const volumeUrl = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/volume?volume_percent",
        {
            volume_percent: amt,
        },
    );
    try {
        const spotifyResult = await axios.put(volumeUrl, {}, config);

        return spotifyResult.data;
    } catch (e) {
        translateAxiosError(e);
    }
}

function getUrlWithParams(urlString: string, queryParams: Record<string, any>) {
    const params = new URLSearchParams(queryParams);
    const url = new URL(urlString);
    url.search = params.toString();
    return url.toString();
}
