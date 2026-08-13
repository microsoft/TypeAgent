// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";

import { loadAgentDebug } from "../src/agentProvider/process/agentDebug.js";

describe("loadAgentDebug", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-debug-"));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("loads an agent-local CommonJS debug module by absolute path", () => {
        const modulePath = path.join(tempDir, "agent.js");
        const debugDir = path.join(tempDir, "node_modules", "debug");
        fs.mkdirSync(debugDir, { recursive: true });
        fs.writeFileSync(modulePath, "export function instantiate() {}\n");
        fs.writeFileSync(
            path.join(debugDir, "index.js"),
            "module.exports = function agentDebug() {};\n",
        );

        const loaded = loadAgentDebug(modulePath, registerDebug);

        expect(loaded).toBeDefined();
        expect(loaded?.debug).not.toBe(registerDebug);
        const loadedStat = loaded && fs.statSync(loaded.path, { bigint: true });
        const expectedStat = fs.statSync(path.join(debugDir, "index.js"), {
            bigint: true,
        });
        expect(loadedStat?.dev).toBe(expectedStat.dev);
        expect(loadedStat?.ino).toBe(expectedStat.ino);
    });

    test("does not return the host debug module as a second instance", () => {
        expect(
            loadAgentDebug(fileURLToPath(import.meta.url), registerDebug),
        ).toBe(undefined);
    });
});
