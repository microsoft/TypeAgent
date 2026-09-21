// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createBrowserControlRpcFacade,
    type BrowserControl,
} from "@typeagent/browser-control-rpc/types";
import { createMemoryServiceRpcFacade } from "@typeagent/memory-service/rpc";
import type { MemoryService } from "@typeagent/memory-service";
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

    test("creates plain facades that preserve method receivers", async () => {
        const browserControl = Object.create({
            getPageUrl() {
                return Promise.resolve(this.url);
            },
        }) as BrowserControl & { url: string };
        browserControl.url = "https://example.com";
        const memoryService = Object.create({
            listCorpora() {
                return Promise.resolve(this.corpora);
            },
        }) as MemoryService & { corpora: [] };
        memoryService.corpora = [];

        const browserFacade = createBrowserControlRpcFacade(browserControl);
        const memoryFacade = createMemoryServiceRpcFacade(memoryService);

        expect(Object.getPrototypeOf(browserFacade)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(memoryFacade)).toBe(Object.prototype);
        await expect(browserFacade.getPageUrl()).resolves.toBe(
            "https://example.com",
        );
        await expect(memoryFacade.listCorpora()).resolves.toEqual([]);
    });
});
