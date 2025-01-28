// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { test as teardown } from "@playwright/test";
import { deleteTestProfiles } from "./testHelper";

// clear up old test profile data
teardown("clear test data", async ({}) => {
    deleteTestProfiles();
});
