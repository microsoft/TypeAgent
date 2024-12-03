// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "../src/dispatcher/dispatcher.js";

describe("basic", () => {
    it("startup and shutdown", async () => {
        // Placeholder for test
        const dispatcher = await createDispatcher("test", {});
        await dispatcher.close();
    });
});
