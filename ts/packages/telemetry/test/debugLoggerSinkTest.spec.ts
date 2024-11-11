// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDebugLoggerSink } from "../src/indexNode.js";

describe("Debug logger sink", () => {
    it("createDebugLoggerSink should succeed", () => {
        const sink = createDebugLoggerSink();

        expect(sink).not.toBeNull();
    });
});
