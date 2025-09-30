// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test, {
    ElectronApplication,
    Page,
    _electron,
    _electron as electron,
    expect,
} from "@playwright/test";
import {
    exitApplication,
    getAppPath,
    sendUserRequestAndWaitForCompletion,
    getLaunchArgs,
    startShell,
    testUserRequest,
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("List Agent Tests", () => {
    test("create_update_clear_list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        await testUserRequest(
            [
                "create a shopping list",
                "what's on the shopping list?",
                "add eggs, milk, flour to the shopping list",
                "what's on the shopping list?",
                "remove milk from the shopping list",
                "what's on the shopping list?",
                "clear the shopping list",
                "what's on the shopping list?",
            ],
            [
                "Created list: shopping",
                "List 'shopping' is empty.",
                "Added items: eggs,milk,flour to list shopping",
                "List 'shopping' has items:\n\neggs\nmilk\nflour",
                "Removed items: milk from list shopping",
                "List 'shopping' has items:\n\neggs\nflour",
                "Cleared list: shopping",
                "List 'shopping' is empty.",
            ],
        );
    });
});
