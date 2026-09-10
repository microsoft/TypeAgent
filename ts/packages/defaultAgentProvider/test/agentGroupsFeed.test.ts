// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDefaultInstalledAgentSource } from "../src/defaultAgentProviders.js";
import { loadAgentGroupCatalog } from "../src/installSources/agentGroups.js";

describe("production agent group feed", () => {
    it("resolves every catalog member from the typeagent source", async () => {
        const instanceDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "ta-agent-group-feed-"),
        );
        const source = createDefaultInstalledAgentSource(instanceDir, {
            configName: "inbox",
        });
        const catalog = loadAgentGroupCatalog();
        const missing: string[] = [];

        for (const group of Object.values(catalog.groups)) {
            for (const member of group.agents) {
                const preview = await source.testApi.preview(
                    member,
                    undefined,
                    "typeagent",
                );
                if (preview === undefined) {
                    missing.push(member);
                    continue;
                }
                expect(preview?.winner).toMatchObject({
                    source: "typeagent",
                    name: member,
                });
            }
        }
        expect(missing).toEqual([]);
    });
});
