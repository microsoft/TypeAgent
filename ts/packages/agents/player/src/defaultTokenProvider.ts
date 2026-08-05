// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync, configSetupHint } from "@typeagent/config";
import { TokenProvider } from "./tokenProvider.js";
import { Storage } from "@typeagent/agent-sdk";

loadConfigSync();

const scopes = [
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-read-private",
    "playlist-modify-public",
    "streaming",
    "user-library-read",
    "user-top-read",
    "user-read-playback-state",
    "user-read-private",
    "user-modify-playback-state",
    "user-read-recently-played",
    "user-read-currently-playing",
    "user-library-modify",
    "user-follow-read",
    "ugc-image-upload",
];

const baseClientId = process.env.SPOTIFY_APP_CLI;
const baseClientSecret = process.env.SPOTIFY_APP_CLISEC;
const defaultPort = process.env.SPOTIFY_APP_PORT;
const spotifyConfigHint = (missing: string[]) =>
    configSetupHint(
        missing,
        "`clientId` and `clientSecret` come from the Spotify developer dashboard for your app; `port` is the redirect port you registered there.",
    );

export async function createTokenProvider(storage?: Storage) {
    if (baseClientId === undefined) {
        throw new Error(
            `Spotify is not configured (missing spotify.clientId).\n${spotifyConfigHint(["SPOTIFY_APP_CLI"])}`,
        );
    }

    if (baseClientSecret === undefined) {
        throw new Error(
            `Spotify is not configured (missing spotify.clientSecret).\n${spotifyConfigHint(["SPOTIFY_APP_CLISEC"])}`,
        );
    }

    if (defaultPort === undefined) {
        throw new Error(
            `Spotify is not configured (missing spotify.port).\n${spotifyConfigHint(["SPOTIFY_APP_PORT"])}`,
        );
    }

    const port = parseInt(defaultPort);
    if (port.toString() !== defaultPort) {
        throw new Error(
            `Spotify spotify.port has invalid port number ${defaultPort}. It must be an integer — the redirect port your Spotify app is registered with.`,
        );
    }

    // Legacy: clean up old files
    if (storage && (await storage.exists("token.json"))) {
        await storage.delete("token.json");
    }

    const refreshTokenStorage = storage
        ? await storage.getTokenCachePersistence()
        : undefined;

    return new TokenProvider(
        baseClientId,
        baseClientSecret,
        port,
        scopes,
        refreshTokenStorage,
    );
}
