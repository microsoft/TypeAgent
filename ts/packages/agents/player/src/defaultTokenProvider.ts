// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    loadConfigSync,
    tryReloadConfigKeysSync,
    configSetupError,
} from "@typeagent/config";
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

const CONFIG_NOTE =
    "`clientId` and `clientSecret` come from the Spotify developer dashboard for your app; `port` is the redirect port you registered there.";
const SPOTIFY_CONFIG_KEYS = [
    "SPOTIFY_APP_CLI",
    "SPOTIFY_APP_CLISEC",
    "SPOTIFY_APP_PORT",
] as const;

export async function createTokenProvider(storage?: Storage) {
    // Agent processes are forked with a snapshot of process.env, so re-read
    // the config files here: otherwise settings the user added since startup
    // (and confirmed with `@config agent refresh player`) stay invisible.
    tryReloadConfigKeysSync(SPOTIFY_CONFIG_KEYS);

    const baseClientId = process.env.SPOTIFY_APP_CLI;
    const baseClientSecret = process.env.SPOTIFY_APP_CLISEC;
    const defaultPort = process.env.SPOTIFY_APP_PORT;

    if (baseClientId === undefined) {
        throw configSetupError(
            "Spotify is not configured (missing spotify.clientId).",
            ["SPOTIFY_APP_CLI"],
            CONFIG_NOTE,
        );
    }

    if (baseClientSecret === undefined) {
        throw configSetupError(
            "Spotify is not configured (missing spotify.clientSecret).",
            ["SPOTIFY_APP_CLISEC"],
            CONFIG_NOTE,
        );
    }

    if (defaultPort === undefined) {
        throw configSetupError(
            "Spotify is not configured (missing spotify.port).",
            ["SPOTIFY_APP_PORT"],
            CONFIG_NOTE,
        );
    }

    const port = parseInt(defaultPort);
    if (port.toString() !== defaultPort) {
        throw configSetupError(
            `Spotify spotify.port has an invalid port number: ${defaultPort}. It must be an integer.`,
            ["SPOTIFY_APP_PORT"],
            CONFIG_NOTE,
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
