// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TokenProvider } from "./tokenProvider.js";

export type User = {
    username?: string | undefined;
    id?: string | undefined;
};

export class SpotifyService {
    private loggedInUser: User | null;

    constructor(public readonly tokenProvider: TokenProvider) {
        this.loggedInUser = null;
    }

    retrieveUser(): User {
        if (this.loggedInUser === null) {
            throw new Error("SpotifyService: no loggedInUser");
        }
        return this.loggedInUser;
    }

    storeUser(user: User) {
        this.loggedInUser = user;
    }

    async init(): Promise<void> {
        await this.tokenProvider.getClientCredentials();
    }
}
