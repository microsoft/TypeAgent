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
    testUserRequest
} from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("List Agent Tests", () => {

    test("create_update_list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        await testUserRequest(
            [
                "create a shopping list", 
                "what's on the shopping list?",
                "add eggs, milk, flower to the shopping list",
                "what's on the shopping list?",
                "remove milk from the grocery list",
                "what's on the shopping list?"
            ], 
            [
                "Created list: shopping", 
                "List 'shopping' is empty",
                "Added items: eggs,milk,flour to list shopping",
                "eggs\nmilk\nfoour",
                "Removed items: milk from list grocery",
                "eggs\nflour"
            ]);
    });

    test("delete_list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}`);

        await testUserRequest(
            [
                "delete shopping list", 
                "is there a shopping list?"
            ], 
            [
                "Cleared list: shopping", 
                "List 'shopping' is empty"
            ]);
    });
});
