// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import * as urlResolver from "../src/urlResolver.js";
import { bingWithGrounding } from "../src/index.js";

dotenv.config({
    path: new URL("../../../../.env", import.meta.url),
});

function testIf(
    runIf: () => boolean,
    name: string,
    fn: jest.ProvidesCallback,
    testTimeout?: number | undefined,
) {
    if (!runIf()) {
        return test.skip(name, () => {});
    }
    return test(name, fn, testTimeout);
}

function hasUrlResolverApiKey() {
    try {
        const appSettings = bingWithGrounding.apiSettingsFromEnv();
        return (
            appSettings.urlResolutionAgentId !== undefined &&
            appSettings.urlResolutionAgentId.length > 0 &&
            appSettings.validatorAgentId !== undefined &&
            appSettings.validatorAgentId.length > 0
        );
    } catch {}
    return false;
}

describe("urlResolver", () => {
    testIf(
        () => hasUrlResolverApiKey(),
        "urlResolver.resolveUrl",
        async () => {
            const resolved = await urlResolver.resolveURLWithSearch(
                "microsoft",
                bingWithGrounding.apiSettingsFromEnv(),
            );

            expect(resolved).toBe("https://www.microsoft.com/en-us/");
        },
    );

    testIf(
        () => hasUrlResolverApiKey(),
        "urlResolver.validateUrl",
        async () => {
            const validated: urlResolver.urlValidityAction | undefined =
                await urlResolver.validateURL(
                    "microsoft",
                    "https://www.microsoft.com/en-us/",
                    bingWithGrounding.apiSettingsFromEnv(),
                );

            expect(validated?.urlValidity).toBe("valid");
        },
    );
});
