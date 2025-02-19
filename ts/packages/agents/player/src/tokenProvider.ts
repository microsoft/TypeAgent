// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import open from "open";

import express from "express";
import axios, { AxiosRequestConfig } from "axios";
import { translateAxiosError } from "./utils.js";
import { Server } from "http";
import querystring from "querystring";
import { TokenCachePersistence } from "@typeagent/agent-sdk";

const tokenUri = "https://accounts.spotify.com/api/token";
function getExpiredDate(expiresIn: number) {
    // Leave one minute buffer
    return Date.now() + (expiresIn - 60) * 1000;
}

export class TokenProvider {
    private userRefreshToken: string | undefined;
    private userAccessToken: string | undefined;
    private userAccessTokenExpiration = 0;

    private clientToken: string | undefined;
    private clientTokenExpiration = 0;

    constructor(
        private readonly clientId: string,
        private readonly clientSecret: string,
        private readonly redirectPort: number,
        private readonly scopes: string[],
        private readonly tokenCachePersistence?: TokenCachePersistence,
    ) {}

    private getAxiosRequestConfig(
        authorization: boolean = false,
    ): AxiosRequestConfig {
        const config: AxiosRequestConfig = {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(
                    `${this.clientId}:${this.clientSecret}`,
                ).toString("base64")}`,
            },
        };
        return config;
    }

    public async getAccessToken(): Promise<string> {
        if (
            this.userAccessToken !== undefined &&
            this.userAccessTokenExpiration > Date.now()
        ) {
            return this.userAccessToken;
        }
        const refreshToken = await this.loadRefreshToken();
        if (refreshToken === undefined) {
            // request both the refresh token and the access token
            return this.requestTokens();
        }

        // Use the refresh token to get a new access token
        const data = {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        };

        const config = this.getAxiosRequestConfig();

        try {
            const result = await axios.post(tokenUri, data, config);
            if (result.status !== 200) {
                throw new Error(
                    `Unable to get access token. (Status: ${result.status})`,
                );
            }
            if (
                result.data.scope.split(" ").sort().join(" ") !==
                this.scopes.sort().join(" ")
            ) {
                // request both the refresh token and the access token to update the scope
                return this.requestTokens();
            }
            this.userAccessToken = result.data.access_token;
            this.userAccessTokenExpiration = getExpiredDate(
                result.data.expires_in,
            );
        } catch (e: any) {
            if (
                e.response?.status === 400 &&
                e.response?.data.error === "invalid_grant"
            ) {
                // Request the refresh token again.
                return this.requestTokens();
            }
            translateAxiosError(e);
        }
        return this.userAccessToken!;
    }

    public async getClientCredentials() {
        if (
            this.clientToken !== undefined &&
            this.clientTokenExpiration > Date.now()
        ) {
            return this.clientToken;
        }

        const data = "grant_type=client_credentials";
        const config = this.getAxiosRequestConfig();

        try {
            const result = await axios.post(tokenUri, data, config);
            this.clientToken = result.data.access_token;
            this.clientTokenExpiration = getExpiredDate(result.data.expires_in);
        } catch (e) {
            translateAxiosError(e);
        }

        return this.clientToken;
    }

    private async requestTokens() {
        const authzCode = await this.requestAuthzCode();
        const data = {
            grant_type: "authorization_code",
            code: authzCode,
            redirect_uri: this.getRedirectUrl(),
        };
        const config = this.getAxiosRequestConfig();
        try {
            const result = await axios.post(tokenUri, data, config);
            if (result.status !== 200) {
                throw new Error(
                    `Unable to get access token. (Status: ${result.status})`,
                );
            }
            this.userRefreshToken = result.data.refresh_token;
            this.userAccessToken = result.data.access_token;
            this.userAccessTokenExpiration = getExpiredDate(
                result.data.expires_in,
            );
        } catch (e) {
            translateAxiosError(e);
        }

        // Note that we don't await this call, and error is ignored.
        this.saveRefreshToken().catch();

        return this.userAccessToken!;
    }
    private async requestAuthzCode() {
        const query = querystring.stringify({
            client_id: this.clientId,
            response_type: "code",
            redirect_uri: this.getRedirectUrl(),
            scope: this.scopes.join(" "),
            show_dialog: "false",
        });
        const url = `https://accounts.spotify.com/authorize?${query}`;
        const app = express();
        const authzCodeP = new Promise<string>((resolve, reject) => {
            app.get("/callback", (req, res) => {
                res.status(200).send("You can close this window now");
                if (req.query.error) {
                    reject(
                        new Error(
                            `Authorization Failed. Error: ${req.query.error}`,
                        ),
                    );
                }
                resolve(req.query.code as string);
            });
        });
        const server = await new Promise<Server>((resolve, reject) => {
            const server = app.listen(this.redirectPort, "127.0.0.1", () => {
                resolve(server);
            });
        });
        try {
            console.log("Opening browser to get authorization code");
            open(url, { wait: false });
            return await authzCodeP;
        } finally {
            server.close();
        }
    }

    private getRedirectUrl() {
        return `http://127.0.0.1:${this.redirectPort}/callback`;
    }

    private async loadRefreshToken() {
        if (
            this.userRefreshToken === undefined &&
            this.tokenCachePersistence !== undefined
        ) {
            try {
                const tokenCacheString =
                    await this.tokenCachePersistence.load();
                if (tokenCacheString !== null) {
                    const tokenCache: TokenCache = JSON.parse(tokenCacheString);
                    this.userRefreshToken = tokenCache.refreshToken;
                }
            } catch (e) {}
        }
        return this.userRefreshToken;
    }

    private async saveRefreshToken() {
        if (
            this.userRefreshToken !== undefined &&
            this.tokenCachePersistence !== undefined
        ) {
            const tokenCache: TokenCache = {
                refreshToken: this.userRefreshToken,
            };
            await this.tokenCachePersistence.save(JSON.stringify(tokenCache));
        }
    }
}

interface TokenCache {
    refreshToken: string;
}
