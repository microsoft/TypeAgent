// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withAutomationSources } from "../src/automationSources.js";
import {
    createRunbookHostCapabilities,
    withRunbookHostCapabilities,
} from "../src/runbookCapabilities.js";
import { createLocalSkillServices } from "../src/skillCatalog.js";

describe("TypeAgent automation sources", () => {
    const instanceDir = "instance";

    test("provides only the flow store location, without a macro owner", () => {
        expect(withAutomationSources(undefined, instanceDir)).toEqual({
            browser: { automations: { instanceDir } },
        });
    });

    test("wraps bare browser control without losing its identity", () => {
        const browserControl = { openTab: () => {} };
        const memory = { marker: "memory" };
        expect(
            withAutomationSources(
                { browser: browserControl, memory },
                instanceDir,
            ),
        ).toEqual({
            browser: { browserControl, automations: { instanceDir } },
            memory,
        });
    });

    test("preserves browser services and replaces stale macro sources", () => {
        const browserControl = {};
        const memoryServiceClient = {};
        const runbookCapabilities = {};
        const options = {
            browser: {
                browserControl,
                memoryServiceClient,
                runbookCapabilities,
                automations: { instanceDir: "old", macros: {} },
            },
        };
        expect(withAutomationSources(options, instanceDir)).toEqual({
            browser: {
                browserControl,
                memoryServiceClient,
                runbookCapabilities,
                automations: { instanceDir },
            },
        });
        expect(options.browser.automations.instanceDir).toBe("old");
    });

    test("composes with embedded runbook capability initialization", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "automation-options-"),
        );
        try {
            const { skillCatalog } = await createLocalSkillServices(root);
            const runbookCapabilities = createRunbookHostCapabilities({
                skillCatalog,
            });
            const options = withRunbookHostCapabilities(
                undefined,
                runbookCapabilities,
            );
            expect(withAutomationSources(options, instanceDir)).toEqual({
                browser: {
                    runbookCapabilities,
                    automations: { instanceDir },
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test.each(["server", "inProcessAgentServer"])(
        "%s wires the flow catalog into browser initialization",
        (entryPoint) => {
            const source = readFileSync(
                new URL(`../../src/${entryPoint}.ts`, import.meta.url),
                "utf8",
            );
            expect(source).toMatch(
                /agentInitOptions:\s*withAutomationSources\(/,
            );
        },
    );
});
