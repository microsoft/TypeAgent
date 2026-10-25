// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getConfiguredViewModelOptions } from "../src/viewModelOptions.js";
import { createDurableMemoryService } from "../src/durableMemoryService.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("the host enables derived Views without an environment opt-in", async () => {
    const previous = process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    const root = await mkdtemp(path.join(os.tmpdir(), "host-default-views-"));
    const service = createDurableMemoryService(root);
    try {
        expect((await service.getCapabilities()).derivedViews).toMatchObject({
            builds: true,
            informationalWiki: true,
            kinds: [
                "troubleshootingGuide",
                "projectBrief",
                "timeline",
                "wiki",
                "schemaView",
            ],
        });
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
        else process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = previous;
    }
});

test("explicit Views use only their own configured model endpoint", () => {
    const checked: string[] = [];
    const hasEndpoint = (endpoint: string) => {
        checked.push(endpoint);
        return endpoint === "azure:VIEW_MODEL";
    };
    expect(getConfiguredViewModelOptions({}, hasEndpoint)).toEqual({});
    expect(checked).toEqual([]);
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "retired",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            },
            hasEndpoint,
        ),
    ).toEqual({});
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT: " azure:VIEW_MODEL ",
            },
            hasEndpoint,
        ),
    ).toEqual({ viewModelEndpoint: "azure:VIEW_MODEL" });
    expect(() =>
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT: "azure:MISSING",
            },
            hasEndpoint,
        ),
    ).toThrow("not available");
});
