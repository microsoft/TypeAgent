// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, test } from "@playwright/test";
import {
    runTestCallback,
    sendUserRequestAndWaitForResponse,
} from "./testHelper";

test("the shell speech provider command selects Azure through chat", async () => {
    await runTestCallback(async (page) => {
        const response = await sendUserRequestAndWaitForResponse(
            "@shell speechProvider azure",
            page,
        );
        expect(response).toContain("Speech provider: azure.");
        expect(
            await page.evaluate(() => globalThis.api.getSpeechProvider()),
        ).toBe("azure");
    });
});
