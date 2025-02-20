// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpeechToken } from "../../preload/electronTypes.js";
import { getClientAPI } from "./main";

// globally share a token cache
let speechToken: SpeechToken | undefined;
export async function getSpeechToken(): Promise<SpeechToken | undefined> {
    if (getClientAPI() != undefined) {
        if (speechToken === undefined || speechToken.expire <= Date.now()) {
            speechToken = await getClientAPI().getSpeechToken();
        }
    }
    return speechToken;
}

export function setSpeechToken(token: SpeechToken) {
    speechToken = token;
}
