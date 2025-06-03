// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AccessToken, DefaultAzureCredential } from "@azure/identity";
import { Result, success, error } from "typechat";

export interface AuthTokenProvider {
    getAccessToken(): Promise<Result<string>>;
    refreshToken(): Promise<Result<string>>;
}

export enum AzureTokenScopes {
    CogServices = "https://cognitiveservices.azure.com/.default",
    AzureMaps = "https://atlas.microsoft.com/.default",
}

export function createAzureTokenProvider(
    scope: AzureTokenScopes,
    expirationBufferMs: number = 5 * 60 * 1000, // 5 minute buffer on renewal
): AuthTokenProvider {
    const credential = new DefaultAzureCredential();
    let accessToken: AccessToken | undefined;
    let refreshPromise: Promise<Result<string>> | undefined;
    return {
        getAccessToken,
        refreshToken,
    };

    // Function to get the access token
    async function getAccessToken(): Promise<Result<string>> {
        if (!accessToken || isTokenExpired()) {
            return beginRefresh();
        }
        return success(accessToken!.token);
    }

    async function refreshToken(): Promise<Result<string>> {
        try {
            const tokenResponse = await credential.getToken(scope);
            tokenResponse.expiresOnTimestamp -= expirationBufferMs;
            accessToken = tokenResponse;
            return success(accessToken.token);
        } catch (e: any) {
            return error(e.toString());
        }
    }

    // Prevents multiple calls to refresh while one is pending
    function beginRefresh(): Promise<Result<string>> {
        if (refreshPromise === undefined) {
            refreshPromise = new Promise<Result<string>>((resolve) => {
                refreshToken()
                    .then((result) => {
                        resolve(result);
                    })
                    .catch((e) => {
                        resolve(error(`refreshToken error ${e}`));
                    });
            }).finally(() => {
                refreshPromise = undefined;
            });
        }
        return refreshPromise;
    }

    function isTokenExpired(): boolean {
        if (!accessToken) {
            return true;
        }
        const now = Date.now();
        return accessToken.expiresOnTimestamp <= now;
    }
}
