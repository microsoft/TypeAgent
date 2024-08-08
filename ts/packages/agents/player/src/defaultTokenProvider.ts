// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TokenProvider, RefreshTokenStorage } from "./tokenProvider.js";
import { Storage } from "dispatcher-agent";

export type SpotifyConfig = {
    refreshToken?: string;
};

class RefreshTokenInConfigFile implements RefreshTokenStorage {
    constructor(
        private readonly profileStorage: Storage,
        private readonly storagePath: string,
    ) {}
    public async load() {
        const config = await this.getConfigFileContent();
        return config.refreshToken;
    }

    public async save(refreshToken: string) {
        const configFileContent = await this.getConfigFileContent();

        configFileContent.refreshToken = refreshToken;
        return this.profileStorage.write(
            this.storagePath,
            JSON.stringify(configFileContent, undefined, 2),
        );
    }

    private async getConfigFileContent(): Promise<SpotifyConfig> {
        if (this.profileStorage.exists(this.storagePath)) {
            return JSON.parse(
                await this.profileStorage.read(this.storagePath, "utf8"),
            );
        }
        return {};
    }
}

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
export function createTokenProvider(storage?: Storage) {
    if (baseClientId === undefined) {
        throw new Error("SPOTIFY_APP_CLI not set");
    }

    if (baseClientSecret === undefined) {
        throw new Error("SPOTIFY_APP_CLISEC not set");
    }

    if (defaultPort === undefined) {
        throw new Error("SPOTIFY_APP_PORT not set");
    }

    const refreshTokenStorage = storage
        ? new RefreshTokenInConfigFile(storage, "token.json")
        : undefined;
    return new TokenProvider(
        baseClientId,
        baseClientSecret,
        defaultPort,
        scopes,
        refreshTokenStorage,
    );
}
