// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpeechToken } from "../../preload/electronTypes";
export type { SpeechToken };
import { getClientAPI } from "./main";

// globally share a token cache
let speechToken: SpeechToken | undefined;
export async function getSpeechToken(
    silent: boolean = true,
): Promise<SpeechToken | undefined> {
    if (getClientAPI() != undefined) {
        if (speechToken === undefined || speechToken.expire <= Date.now()) {
            speechToken = await getClientAPI().getSpeechToken(silent);
        }
    }
    return speechToken;
}

export function setSpeechToken(token: SpeechToken) {
    speechToken = token;
}
