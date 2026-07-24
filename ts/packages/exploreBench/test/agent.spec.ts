// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBenchmarkAgent, parseBenchmarkAgent } from "../src/agent.js";

test("loads the root explorer custom agent in Copilot markdown format", async () => {
    const file = path.resolve(
        process.cwd(),
        "../../../.copilot/agents/explorer.md",
    );
    const agent = await loadBenchmarkAgent(file);

    assert.equal(agent.name, "explorer");
    assert.match(agent.description, /read-only repository localization/i);
    assert.deepEqual(agent.tools, ["read", "grep", "glob", "ls"]);
    assert.match(agent.prompt, /use only.*read.*grep.*glob.*ls/is);
    assert.doesNotMatch(agent.prompt, /MCP|TypeAgent|explore tool/i);
    assert.match(agent.prompt, /<final_answer>/);
    assert.equal(agent.file, file);
    assert.match(agent.sha256, /^[a-f0-9]{64}$/);
});

test("parses the documented frontmatter shape and rejects unsafe ambiguity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "explorer-agent-test-"));
    try {
        const file = path.join(root, "agent.md");
        await writeFile(
            file,
            [
                "---",
                "name: explorer",
                'description: "Focused explorer"',
                'tools: ["read", "explore"]',
                "---",
                "",
                "Inspect the repository.",
            ].join("\n"),
        );
        const parsed = await loadBenchmarkAgent(file);
        assert.equal(parsed.name, "explorer");
        assert.equal(parsed.description, "Focused explorer");
        assert.deepEqual(parsed.tools, ["read", "explore"]);
        assert.equal(parsed.prompt, "Inspect the repository.");
        assert.throws(
            () =>
                parseBenchmarkAgent(
                    '---\nname: explorer\ndescription: duplicate tools\ntools: ["read", "read"]\n---\nprompt',
                    file,
                ),
            /unique/i,
        );
        assert.throws(
            () => parseBenchmarkAgent("no frontmatter", file),
            /frontmatter/i,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
