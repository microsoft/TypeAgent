// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { test as setup } from "@playwright/test";
import { deleteTestProfiles } from "./testHelper";

// clear up old test profile data
setup("clear old test data", async ({}) => {
    deleteTestProfiles();
});
