// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "@playwright/test";
import { testUserRequest } from "./testHelper";

// Annotate entire file as serial.
test.describe.configure({ mode: "serial" });

test.describe("List Agent Tests", () => {
    test("create_update_clear_list", async ({}, testInfo) => {
        console.log(`Running test '${testInfo.title}'`);

        await testUserRequest(
            [
                "create a shopping list",
                "what's on the shopping list?",
                "add bread, milk, flour to the shopping list",
                "what's on the shopping list?",
                "remove milk from the shopping list",
                "what's on the shopping list?",
                "clear the shopping list",
                "what's on the shopping list?",
            ],
            [
                "Created list: shopping",
                // Each list-query step accepts both the plain-text display and
                // the structured-output display (heading + list block) so the
                // test passes whether or not the list agent has been switched
                // to structured output. Keep the structured strings in sync
                // with buildListResult() in listActionHandler.ts.
                [
                    "List 'shopping' is empty.",
                    "List 'shopping'\n\nThis list is empty.",
                ],
                "Added items: bread,milk,flour to list shopping",
                [
                    "List 'shopping' has items:\n\nbread\nmilk\nflour",
                    "List 'shopping' \u2014 3 items\n\nbread\nmilk\nflour",
                ],
                "Removed items: milk from list shopping",
                [
                    "List 'shopping' has items:\n\nbread\nflour",
                    "List 'shopping' \u2014 2 items\n\nbread\nflour",
                ],
                "Cleared list: shopping",
                [
                    "List 'shopping' is empty.",
                    "List 'shopping'\n\nThis list is empty.",
                ],
            ],
        );
    });
});
