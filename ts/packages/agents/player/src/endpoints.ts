// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpotifyService } from "./service.js";
import registerDebug from "debug";
import { createFetchError } from "./utils.js";

const debugSpotifyRest = registerDebug("typeagent:spotify:rest");

export const limitMax = 50;

export async function search(
    query: SpotifyApi.SearchForItemParameterObject,
    service: SpotifyService,
) {
    return fetchGet<SpotifyApi.SearchResponse>(
        service,
        "https://api.spotify.com/v1/search",
        query,
    );
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

async function callFetch<T>(
    service: SpotifyService,
    method: string,
    restUrl: string,
    params: Record<string, any> | undefined,
    successCode: 200 | 201,
): Promise<T>;
async function callFetch<T>(
    service: SpotifyService,
    method: string,
    restUrl: string,
    params: Record<string, any> | undefined,
    successCode: 204,
): Promise<undefined>;
async function callFetch<T>(
    service: SpotifyService,
    method: string,
    restUrl: string,
    params?: Record<string, any>,
): Promise<T | undefined>;
async function callFetch<T>(
    service: SpotifyService,
    method: string,
    restUrl: string,
    params?: Record<string, any>,
    successCode?: 200 | 201 | 204,
): Promise<T | undefined> {
    const options: RequestInit = {
        method,
        headers: {
            Authorization: `Bearer ${await service.tokenProvider.getAccessToken()}`,
        },
    };

    let url = restUrl;

    if (params !== undefined) {
        if (method === "GET") {
            url = getUrlWithParams(restUrl, params);
        } else {
            options.body = JSON.stringify(params);
        }
    }
    try {
        const result = await fetch(url, options);
        if (result === undefined) {
            throw new Error("No response");
        }
        debugSpotifyRest(`${restUrl}`, result.status, result.statusText);
        if (result.ok) {
            if (successCode === 204) {
                // pretend we didn't get any data if we expected 204
                return undefined;
            }
            if (successCode === undefined || result.status === successCode) {
                // spotify only using 200, 201 and 204
                switch (result.status) {
                    case 200:
                    case 201:
                        const content = await result.text();
                        debugSpotifyRest("Response content:", content);
                        if (content === "") {
                            return {} as T;
                        }
                        return JSON.parse(content) as T;
                    case 204:
                        return undefined;
                }
            }
        }

        throw await createFetchError(`${method} ${url} failed`, result);
    } catch (e: any) {
        const errorStr = `fetch error: ${e.cause?.message ?? e.message}`;
        debugSpotifyRest(errorStr);
        throw new Error(errorStr);
    }
}

async function fetchGet<T>(
    service: SpotifyService,
    restUrl: string,
    params?: Record<string, any>,
): Promise<T> {
    return callFetch<T>(service, "GET", restUrl, params, 200);
}

async function fetchGetAllowEmptyResult<T>(
    service: SpotifyService,
    restUrl: string,
    params?: Record<string, any>,
): Promise<T | undefined> {
    return callFetch<T>(service, "GET", restUrl, params);
}

async function fetchPutEmptyResult(
    service: SpotifyService,
    restUrl: string,
    params?: Record<string, any>,
): Promise<void> {
    // All the put call expects a 204 response
    await callFetch(service, "PUT", restUrl, params, 204);
}

async function fetchPost<T>(
    service: SpotifyService,
    restUrl: string,
    params?: Record<string, any>,
): Promise<T> {
    return callFetch<T>(service, "POST", restUrl, params, 201);
}

async function fetchPostEmptyResult(
    service: SpotifyService,
    restUrl: string,
    params?: Record<string, any>,
): Promise<void> {
    await callFetch(service, "POST", restUrl, params, 204);
}

async function fetchDelete<T>(
    service: SpotifyService,
    restUrl: string,
): Promise<T> {
    // All the delete call expects a 200 response
    return callFetch<T>(service, "DELETE", restUrl, undefined, 200);
}

export async function getFavoriteAlbums(service: SpotifyService, k = limitMax) {
    const get = async (limit: number, offset: number) =>
        fetchGet<SpotifyApi.UsersSavedAlbumsResponse>(
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
        fetchGet<SpotifyApi.UsersSavedTracksResponse>(
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
        fetchGet<SpotifyApi.UsersTopArtistsResponse>(
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
        fetchGet<SpotifyApi.UsersTopTracksResponse>(
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
            await fetchGet<SpotifyApi.UsersFollowedArtistsResponse>(
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
        fetchGet<SpotifyApi.UsersRecentlyPlayedTracksResponse>(
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
    const artistsUrl = `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`;
    return fetchGet<SpotifyApi.SingleArtistResponse>(service, artistsUrl);
}

export async function getArtists(service: SpotifyService, ids: string[]) {
    return fetchGet<SpotifyApi.MultipleArtistsResponse>(
        service,
        "https://api.spotify.com/v1/artists",
        { ids },
    );
}

export async function getArtistTopTracks(service: SpotifyService, id: string) {
    return fetchGet<SpotifyApi.ArtistsTopTracksResponse>(
        service,
        `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}/top-tracks`,
    );
}

export async function getUserProfile(service: SpotifyService) {
    return fetchGet<SpotifyApi.UserProfileResponse>(
        service,
        "https://api.spotify.com/v1/me",
    );
}

export async function getPlaybackState(service: SpotifyService) {
    return fetchGetAllowEmptyResult<SpotifyApi.CurrentPlaybackResponse>(
        service,
        "https://api.spotify.com/v1/me/player",
    );
}

export async function transferPlayback(
    service: SpotifyService,
    deviceId: string,
    play = false,
) {
    const params = { device_ids: [deviceId], play };
    await fetchPutEmptyResult(
        service,
        "https://api.spotify.com/v1/me/player/",
        params,
    );
}

export async function play(
    service: SpotifyService,
    deviceId: string,
    uris?: string[],
    contextUri?: string,
    trackNumber?: number,
    seekms?: number,
) {
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
    await fetchPutEmptyResult(service, playUrl, smallTrack);
}

export async function getDevices(service: SpotifyService) {
    return fetchGet<SpotifyApi.UserDevicesResponse>(
        service,
        "https://api.spotify.com/v1/me/player/devices",
    );
}

export async function pause(service: SpotifyService, deviceId: string) {
    const pauseUrl = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/pause",
        { device_id: deviceId },
    );
    return fetchPutEmptyResult(service, pauseUrl);
}

export async function getQueue(service: SpotifyService) {
    return fetchGet<SpotifyApi.UsersQueueResponse>(
        service,
        "https://api.spotify.com/v1/me/player/queue",
        { limit: 50 },
    );
}

export async function previous(service: SpotifyService, deviceId: string) {
    return fetchPostEmptyResult(
        service,
        `https://api.spotify.com/v1/me/player/previous?device_id=${deviceId}`,
    );
}

export async function shuffle(
    service: SpotifyService,
    deviceId: string,
    newShuffleState: boolean,
) {
    const url = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/shuffle",
        { state: newShuffleState, device_id: deviceId },
    );
    return fetchPutEmptyResult(service, url);
}

export async function next(service: SpotifyService, deviceId: string) {
    return fetchPostEmptyResult(
        service,
        `https://api.spotify.com/v1/me/player/next?device_id=${deviceId}`,
    );
}

export async function getPlaylists(service: SpotifyService) {
    return fetchGet<SpotifyApi.ListOfCurrentUsersPlaylistsResponse>(
        service,
        "https://api.spotify.com/v1/me/playlists",
    );
}

export async function getAlbum(
    service: SpotifyService,
    id: string,
): Promise<SpotifyApi.SingleAlbumResponse | undefined> {
    return fetchGet<SpotifyApi.SingleAlbumResponse>(
        service,
        `https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`,
    );
}

export async function getAlbums(
    service: SpotifyService,
    ids: string[],
): Promise<SpotifyApi.MultipleAlbumsResponse | undefined> {
    return fetchGet<SpotifyApi.MultipleAlbumsResponse>(
        service,
        "https://api.spotify.com/v1/albums",
        { ids },
    );
}

export async function getAlbumTracks(service: SpotifyService, albumId: string) {
    return fetchGet<SpotifyApi.AlbumTracksResponse>(
        service,
        `https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}/tracks`,
    );
}

export async function getTrack(
    service: SpotifyService,
    id: string,
): Promise<SpotifyApi.SingleTrackResponse | undefined> {
    return fetchGet<SpotifyApi.SingleTrackResponse>(
        service,
        `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`,
    );
}

export async function getTracksFromIdsBatch(
    service: SpotifyService,
    trackIds: string[],
) {
    return fetchGet<SpotifyApi.MultipleTracksResponse>(
        service,
        "https://api.spotify.com/v1/tracks",
        { ids: trackIds },
    );
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
    return fetchGet<SpotifyApi.PlaylistTrackResponse>(
        service,
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
    );
}

export async function deletePlaylist(
    service: SpotifyService,
    playlistId: string,
) {
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/followers`;
    return fetchDelete<SpotifyApi.UnfollowPlaylistResponse>(service, url);
}

export async function createPlaylist(
    service: SpotifyService,
    name: string,
    userId: string,
    uris: string[],
    description = "",
) {
    const createUri = `https://api.spotify.com/v1/users/${userId}/playlists`;
    const playlistResponse = await fetchPost<SpotifyApi.CreatePlaylistResponse>(
        service,
        createUri,
        { name, public: false, description },
    );
    return fetchPost<SpotifyApi.AddTracksToPlaylistResponse>(
        service,
        `https://api.spotify.com/v1/playlists/${playlistResponse.id}/tracks`,
        { uris },
    );
}

export async function setVolume(service: SpotifyService, amt = limitMax) {
    const volumeUrl = getUrlWithParams(
        "https://api.spotify.com/v1/me/player/volume?volume_percent",
        { volume_percent: amt },
    );
    return fetchPutEmptyResult(service, volumeUrl);
}

function getUrlWithParams(urlString: string, queryParams: Record<string, any>) {
    const params = new URLSearchParams(queryParams);
    const url = new URL(urlString);
    url.search = params.toString();
    return url.toString();
}
