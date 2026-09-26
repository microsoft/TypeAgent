// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("plugin manifests", () => {
    it("exposes remember, recall, and both capture hooks", async () => {
        const root = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const plugin = JSON.parse(
            await readFile(path.join(root, "plugin.json"), "utf8"),
        ) as { name: string; hooks: string; mcpServers: string };
        const hooks = JSON.parse(
            await readFile(path.join(root, plugin.hooks), "utf8"),
        ) as {
            hooks: Record<string, { command: string }[]>;
        };
        const mcp = JSON.parse(
            await readFile(path.join(root, plugin.mcpServers), "utf8"),
        ) as {
            mcpServers: Record<string, { args: string[]; tools: string[] }>;
        };

        expect(plugin.name).toBe("typeagent-memory");
        // Entry points must be the esbuild output so installed copies do not
        // depend on workspace packages resolved via pnpm symlinks.
        for (const event of ["userPromptSubmitted", "userPromptTransformed"]) {
            expect(hooks.hooks[event]?.[0]?.command).toContain(
                "dist/bundle/hooks/hook-router.js",
            );
        }
        expect(hooks.hooks.agentStop?.[0]?.command).toContain(
            "dist/bundle/hooks/stop-router.js",
        );
        expect(mcp.mcpServers["typeagent-memory"]?.args).toContain(
            "${PLUGIN_ROOT}/dist/bundle/mcp/server.js",
        );
        expect(mcp.mcpServers["typeagent-memory"]?.tools).toEqual([
            "remember",
            "recall",
        ]);
    });
});
