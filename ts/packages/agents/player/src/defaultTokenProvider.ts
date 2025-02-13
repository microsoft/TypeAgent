// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TokenProvider } from "./tokenProvider.js";
import { Storage } from "@typeagent/agent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../../../.env") });

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
export async function createTokenProvider(storage?: Storage) {
    if (baseClientId === undefined) {
        throw new Error("SPOTIFY_APP_CLI not set");
    }

    if (baseClientSecret === undefined) {
        throw new Error("SPOTIFY_APP_CLISEC not set");
    }

    if (defaultPort === undefined) {
        throw new Error("SPOTIFY_APP_PORT not set");
    }

    const port = parseInt(defaultPort);
    if (port.toString() !== defaultPort) {
        throw new Error(
            `SPOTIFY_APP_PORT has invalid port number ${defaultPort}`,
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
