// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import path from "path";
import { testIf } from "./testCore.js";
import * as bing from "../src/bing.js";

dotenv.config({
    path: path.join(__dirname, "../../../../.env"),
});

function hasBingApiKey() {
    try {
        const appSettings = bing.apiSettingsFromEnv();
        return (
            appSettings.apiKey !== undefined && appSettings.apiKey.length > 0
        );
    } catch {}
    return false;
}

describe("bing", () => {
    const testTimeout = 5 * 60 * 1000;
    testIf(
        () => hasBingApiKey(),
        "searchWeb",
        async () => {
            let pages = await bing.searchWeb("windows");
            expect(pages.length).toBeGreaterThan(0);
        },
        testTimeout,
    );
    testIf(
        () => hasBingApiKey(),
        "searchWeb.count",
        async () => {
            let pages = await bing.searchWeb("windows", 5);
            expect(pages.length).toEqual(5);
        },
        testTimeout,
    );
    testIf(
        () => hasBingApiKey(),
        "search.siteUrl",
        async () => {
            const pages = await bing.searchWeb("windows", 10, "microsoft.com");
            for (const page of pages) {
                expect(page.url).toContain("microsoft.com");
            }
        },
        testTimeout,
    );
});
