// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Server-side Azure Speech authorization-token vending.
 *
 * The agent-server owns the `speech:` configuration (loaded into the
 * `SPEECH_SDK_KEY` / `SPEECH_SDK_REGION` / `SPEECH_SDK_ENDPOINT` env vars by
 * `@typeagent/config`). Thin clients that render a microphone affordance but
 * have no config access (e.g. the VS Code shell webview) request a token over
 * the agent-server RPC and use it with the browser Speech SDK.
 *
 * Auth mirrors the Electron shell's `AzureSpeech`:
 *  - `identity` (default): acquire an Azure AD token for the Cognitive
 *    Services scope via `DefaultAzureCredential`; clients pass it as
 *    `aad#<endpoint>#<token>`.
 *  - a subscription key: exchange it for a short-lived token at the region's
 *    STS `issuetoken` endpoint.
 */

import { DefaultAzureCredential } from "@azure/identity";
import type { SpeechToken } from "@typeagent/agent-server-protocol";
import registerDebug from "debug";

const debug = registerDebug("agent-server:speech");
const debugError = registerDebug("agent-server:speech:error");

const IdentityApiKey = "identity";
const CogServicesScope = "https://cognitiveservices.azure.com/.default";

// Process-wide cache. Tokens live ~10 minutes; refresh a minute early.
let cachedToken: SpeechToken | undefined;

/**
 * Return a valid Azure Speech authorization token, or `undefined` when speech
 * is not configured (no region) or a token can't be acquired. Results are
 * cached until shortly before expiry.
 */
export async function getSpeechToken(): Promise<SpeechToken | undefined> {
    const region = process.env["SPEECH_SDK_REGION"];
    if (!region) {
        // Speech not configured — clients hide the mic affordance.
        return undefined;
    }
    if (cachedToken !== undefined && cachedToken.expire > Date.now()) {
        return cachedToken;
    }

    const key = process.env["SPEECH_SDK_KEY"] ?? IdentityApiKey;
    // Only identity/AAD tokens use the `aad#<endpoint>#` prefix; key-issued STS
    // tokens must be passed verbatim, so keep endpoint empty for key-based auth.
    // Identity (AAD) tokens must include an endpoint so clients can format
    // `aad#<endpoint>#<token>` for the Speech SDK.
    const endpoint =
        key.toLowerCase() === IdentityApiKey
            ? (process.env["SPEECH_SDK_ENDPOINT"] ?? "")
            : "";
    if (key.toLowerCase() === IdentityApiKey && !endpoint) {
        debugError(
            "identity-based speech tokens require SPEECH_SDK_ENDPOINT to be set",
        );
        return undefined;
    }
    try {
        let token: string;
        if (key.toLowerCase() === IdentityApiKey) {
            if (!endpoint) {
                debugError(
                    "identity-based speech token acquisition requires SPEECH_SDK_ENDPOINT",
                );
                return undefined;
            }
            const result = await new DefaultAzureCredential().getToken(
                CogServicesScope,
            );
            if (!result?.token) {
                debugError(
                    "identity-based speech token acquisition returned no token",
                );
                return undefined;
            }
            token = result.token;
        } else {
            const response = await fetch(
                `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Ocp-Apim-Subscription-Key": key,
                    },
                },
            );
            if (!response.ok) {
                debugError(
                    `key-based speech token request failed: ${response.status} ${response.statusText}`,
                );
                return undefined;
            }
            token = await response.text();
        }

        cachedToken = {
            token,
            // Token is valid for 10 minutes; expire our cache at 9 so callers
            // always receive a token with headroom.
            expire: Date.now() + 9 * 60 * 1000,
            region,
            endpoint,
        };
        debug("issued speech token (region=%s)", region);
        return cachedToken;
    } catch (e) {
        debugError("error acquiring speech token", e);
        return undefined;
    }
}
