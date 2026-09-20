// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserControl } from "@typeagent/browser-control-rpc/types";
import type { MemoryServiceClient } from "@typeagent/memory-client";
import { normalizeBrowserAgentInitOptions } from "../src/agent/browserActions.mjs";

describe("normalizeBrowserAgentInitOptions", () => {
    test("preserves a legacy raw BrowserControl", () => {
        const browserControl = {} as BrowserControl;

        expect(normalizeBrowserAgentInitOptions(browserControl)).toEqual({
            browserControl,
        });
    });

    test("accepts structured browser and memory dependencies", () => {
        const browserControl = {} as BrowserControl;
        const memoryServiceClient = {} as MemoryServiceClient;

        expect(
            normalizeBrowserAgentInitOptions({
                browserControl,
                memoryServiceClient,
            }),
        ).toEqual({ browserControl, memoryServiceClient });
    });

    test("uses external browser control when no options are supplied", () => {
        expect(normalizeBrowserAgentInitOptions(undefined)).toEqual({});
    });
});
