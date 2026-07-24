// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import type { Tool, ToolInvocation } from "@github/copilot-sdk";
import { createRepositoryTools } from "explorer-typeagent";
import {
    createCopilotExplorationTools,
    type CopilotExplorationTools,
} from "../src/copilotTools.js";
import { resolvePackagedRipgrepPath } from "../src/ripgrep.js";
import type { CopilotToolCallTrace } from "../src/types.js";

const invocation: ToolInvocation = {
    sessionId: "test-session",
    toolCallId: "test-tool-call",
    toolName: "test-tool",
    arguments: {},
};

const openTools: CopilotExplorationTools[] = [];

afterEach(async () => {
    await Promise.all(openTools.splice(0).map((tools) => tools.close()));
});

async function makeCopilotTools(
    ...args: Parameters<typeof createCopilotExplorationTools>
): Promise<CopilotExplorationTools> {
    const tools = await createCopilotExplorationTools(...args);
    openTools.push(tools);
    return tools;
}

function requiredTool(tools: Tool<any>[], name: string): Tool<any> {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool?.handler, `missing ${name} tool handler`);
    return tool;
}

test("creates traced SDK tools and uses Copilot's packaged ripgrep", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-tools-"),
    );
    try {
        await writeFile(
            path.join(repo, "README.md"),
            "first\nneedle here\nthird\n",
            "utf8",
        );
        await mkdir(path.join(repo, "src", "nested"), { recursive: true });
        await writeFile(
            path.join(repo, "src", "nested", "fixture.ts"),
            "export const fixture = true;\n",
            "utf8",
        );
        const trace: CopilotToolCallTrace[] = [];
        const tools = await makeCopilotTools(repo, trace);

        assert.deepEqual(
            tools.map((tool) => tool.name),
            ["read", "grep", "glob", "ls"],
        );
        for (const tool of tools) {
            assert.equal(tool.overridesBuiltInTool, true);
            assert.equal(tool.skipPermission, true);
        }

        const read = requiredTool(tools, "read");
        assert.equal(
            await read.handler!(
                { path: "README.md", offset: 2, limit: 1 },
                invocation,
            ),
            "README.md:2: needle here",
        );

        const grep = requiredTool(tools, "grep");
        const oldPath = process.env.PATH;
        process.env.PATH = "";
        try {
            const output = String(
                await grep.handler!(
                    { pattern: "needle", path: "." },
                    invocation,
                ),
            );
            assert.match(output, /README\.md:2:needle here/);
        } finally {
            if (oldPath === undefined) delete process.env.PATH;
            else process.env.PATH = oldPath;
        }

        const glob = requiredTool(tools, "glob");
        assert.equal(
            await glob.handler!(
                { pattern: "*.ts", maxMatches: 50 },
                invocation,
            ),
            "src/nested/fixture.ts",
        );

        assert.deepEqual(
            trace.map(({ tool, ok }) => ({ tool, ok })),
            [
                { tool: "read", ok: true },
                { tool: "grep", ok: true },
                { tool: "glob", ok: true },
            ],
        );
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

test("keeps Copilot and TypeAgent grep results in the same ripgrep order", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-shared-ripgrep-"),
    );
    const packagedRipgrepPath = await resolvePackagedRipgrepPath();
    try {
        await mkdir(path.join(repo, "src"), { recursive: true });
        await mkdir(path.join(repo, ".github", "workflows"), {
            recursive: true,
        });
        await writeFile(
            path.join(repo, "README.md"),
            "needle\nconst literal = 'a.*b';\n",
        );
        await writeFile(
            path.join(repo, "src", "dense.ts"),
            Array.from({ length: 220 }, (_, index) => `needle ${index}`).join(
                "\n",
            ),
        );
        await writeFile(
            path.join(repo, ".github", "workflows", "build.yml"),
            "hidden-workflow-marker\n",
        );
        const copilotTools = await makeCopilotTools(
            repo,
            [],
            100,
            packagedRipgrepPath,
        );
        const copilotGrep = requiredTool(copilotTools, "grep");
        const typeAgent = await createRepositoryTools({
            repoRoot: repo,
            maxCalls: 100,
            ripgrepPath: packagedRipgrepPath,
        });
        try {
            let characterClassMatches:
                | ReturnType<typeof parseCopilotGrepOutput>["matches"]
                | undefined;
            for (const args of [
                { pattern: "needle", maxMatches: 3 },
                { pattern: "a.*b", literal: true },
                { pattern: "needle" },
                { pattern: "needle", maxMatches: 999 },
                {
                    pattern: "needle",
                    path: "src/dense.ts",
                    maxMatches: 2,
                },
                { pattern: "needle", path: "src", maxMatches: 2 },
                {
                    pattern: "needle",
                    glob: "**/[Dd]ense.ts",
                    maxMatches: 2,
                },
                { pattern: "hidden-workflow-marker" },
                { pattern: "needle", path: "missing" },
            ]) {
                const copilot = parseCopilotGrepOutput(
                    String(await copilotGrep.handler!(args, invocation)),
                );
                const typeAgentResult = await typeAgent.api.grep(
                    args.pattern,
                    args,
                );
                assert.deepEqual(typeAgentResult, copilot);
                if (args.glob === "**/[Dd]ense.ts") {
                    characterClassMatches = copilot.matches;
                }
            }
            assert.deepEqual(characterClassMatches, [
                { path: "src/dense.ts", line: 1, text: "needle 0" },
                { path: "src/dense.ts", line: 2, text: "needle 1" },
            ]);
            await assert.rejects(
                async () =>
                    await copilotGrep.handler!(
                        { pattern: "needle(" },
                        invocation,
                    ),
                /regex parse error/i,
            );
            await assert.rejects(
                async () => await typeAgent.api.grep("needle("),
                /regex parse error/i,
            );
            await assert.rejects(
                async () =>
                    await copilotGrep.handler!({ pattern: "" }, invocation),
                /must not be empty/i,
            );
            await assert.rejects(
                async () => await typeAgent.api.grep(""),
                /must not be empty/i,
            );
        } finally {
            await typeAgent.close();
        }
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

test("keeps baseline reads and listings on the immutable filtered snapshot", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-snapshot-"),
    );
    try {
        await writeFile(path.join(repo, "tracked.txt"), "before\n", "utf8");
        const tools = await makeCopilotTools(repo, [], 50);
        const read = requiredTool(tools, "read");
        const ls = requiredTool(tools, "ls");

        await writeFile(path.join(repo, "tracked.txt"), "after\n", "utf8");
        await writeFile(path.join(repo, "late.txt"), "late\n", "utf8");

        assert.equal(
            await read.handler!({ path: "tracked.txt", limit: 1 }, invocation),
            "tracked.txt:1: before",
        );
        assert.equal(
            await ls.handler!({ path: ".", depth: 1 }, invocation),
            "tracked.txt",
        );
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

function parseCopilotGrepOutput(output: string): {
    matches: Array<{ path: string; line: number; text: string }>;
    truncated: boolean;
} {
    const lines = output.split("\n");
    const marker = "[Search results truncated; narrow the pattern or path.]";
    const truncated = lines.at(-1) === marker;
    if (truncated) lines.pop();
    if (lines.length === 1 && lines[0] === "No matches") {
        return { matches: [], truncated };
    }
    const matches = lines.map((line) => {
        const match = /^(.*?):(\d+):(.*)$/u.exec(line);
        assert.ok(match, `unexpected Copilot grep line: ${line}`);
        return { path: match[1], line: Number(match[2]), text: match[3] };
    });
    return { matches, truncated };
}

test("keeps file access inside the repository, including through symlinks", async () => {
    const parent = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-root-"),
    );
    const repo = path.join(parent, "repo");
    try {
        await mkdir(repo);
        await writeFile(path.join(parent, "outside.txt"), "outside\n", "utf8");
        await symlink(
            path.join(parent, "outside.txt"),
            path.join(repo, "escape.txt"),
        );

        const tools = await makeCopilotTools(repo, []);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");
        const glob = requiredTool(tools, "glob");

        await assert.rejects(
            async () =>
                await read.handler!({ path: "../outside.txt" }, invocation),
            /relative POSIX paths/,
        );
        await assert.rejects(
            async () => await read.handler!({ path: "escape.txt" }, invocation),
            /not available to repository tools/,
        );
        await assert.rejects(
            async () =>
                await grep.handler!(
                    { pattern: "outside", path: ".." },
                    invocation,
                ),
            /relative POSIX paths/,
        );
        await assert.rejects(
            async () => await glob.handler!({ pattern: "../*" }, invocation),
            /repository-relative/i,
        );
    } finally {
        await rm(parent, { recursive: true, force: true });
    }
});

test("rejects secret files and scrubs their contents", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-safe-"),
    );
    const secretName = "TYPEAGENT_COPILOT_TOOLS_TEST_SECRET";
    const oldSecret = process.env[secretName];
    process.env[secretName] = "secret-from-parent";
    try {
        await writeFile(
            path.join(repo, ".env"),
            "TOKEN=secret-from-file\n",
            "utf8",
        );
        await writeFile(
            path.join(repo, ".npmrc"),
            "//registry/:_authToken=secret-from-npmrc\n",
            "utf8",
        );
        await writeFile(
            path.join(repo, "private.pem"),
            "secret-from-private-key\n",
            "utf8",
        );
        const trace: CopilotToolCallTrace[] = [];
        const tools = await makeCopilotTools(repo, trace, 50);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");

        await assert.rejects(
            async () => await read.handler!({ path: ".env" }, invocation),
            /not available to repository tools/,
        );
        await assert.rejects(
            async () => await read.handler!({ path: ".npmrc" }, invocation),
            /not available to repository tools/,
        );
        await assert.rejects(
            async () =>
                await read.handler!({ path: "private.pem" }, invocation),
            /not available to repository tools/,
        );
        assert.equal(
            await grep.handler!(
                { pattern: "secret", path: ".", glob: ".env" },
                invocation,
            ),
            "No matches",
        );
        assert.equal(
            await grep.handler!(
                { pattern: "secret-from", path: "." },
                invocation,
            ),
            "No matches",
        );
        assert.equal(trace.filter((entry) => !entry.ok).length, 3);
        assert.doesNotMatch(
            JSON.stringify(trace),
            /secret-from-(?:file|npmrc|parent|private-key)/,
        );
    } finally {
        if (oldSecret === undefined) delete process.env[secretName];
        else process.env[secretName] = oldSecret;
        await rm(repo, { recursive: true, force: true });
    }
});

test("bounds read, grep, glob, and ls output", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-bounds-"),
    );
    try {
        const lines = Array.from(
            { length: 1_100 },
            (_, index) => `match-${index}-${"x".repeat(600)}`,
        );
        await writeFile(path.join(repo, "large.txt"), lines.join("\n"), "utf8");
        await writeFile(
            path.join(repo, "too-large.txt"),
            "x".repeat(1024 * 1024 + 1),
            "utf8",
        );
        await Promise.all(
            Array.from({ length: 250 }, (_, index) =>
                writeFile(
                    path.join(
                        repo,
                        `listing-${String(index).padStart(3, "0")}-${"x".repeat(60)}.txt`,
                    ),
                    "",
                    "utf8",
                ),
            ),
        );

        const tools = await makeCopilotTools(repo, []);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");
        const glob = requiredTool(tools, "glob");
        const ls = requiredTool(tools, "ls");

        const readLines = String(
            await read.handler!(
                { path: "large.txt", limit: 9_999 },
                invocation,
            ),
        ).split("\n");
        assert.equal(readLines.length, 1_000);
        assert.ok(readLines.every((line) => line.length <= 520));
        await assert.rejects(
            async () =>
                await read.handler!({ path: "too-large.txt" }, invocation),
            /not available to repository tools/,
        );

        const grepLines = String(
            await grep.handler!(
                { pattern: "match-", path: "large.txt", maxMatches: 9_999 },
                invocation,
            ),
        ).split("\n");
        assert.equal(grepLines.length, 201);
        assert.match(grepLines.at(-1) ?? "", /results truncated/i);

        const globLines = String(
            await glob.handler!(
                { pattern: "*.txt", maxMatches: 200 },
                invocation,
            ),
        ).split("\n");
        assert.equal(globLines.length, 200);

        const lsLines = String(
            await ls.handler!({ path: ".", maxEntries: 200 }, invocation),
        ).split("\n");
        assert.equal(lsLines.length, 200);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

test("uses a finite default budget and bounds exhausted traces", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-default-budget-"),
    );
    try {
        await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
        const trace: CopilotToolCallTrace[] = [];
        const tools = await makeCopilotTools(repo, trace);
        const read = requiredTool(tools, "read");

        for (let index = 0; index < 8; index += 1) {
            assert.match(
                String(await read.handler!({ path: "README.md" }, invocation)),
                /fixture/,
            );
        }
        assert.match(
            String(await read.handler!({ path: "README.md" }, invocation)),
            /TOOL_BUDGET_EXHAUSTED/,
        );
        const traceLength = trace.length;
        assert.match(
            String(await read.handler!({ path: "README.md" }, invocation)),
            /TOOL_BUDGET_EXHAUSTED/,
        );
        assert.equal(trace.length, traceLength);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

test("bounds trace arguments and errors", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-trace-bounds-"),
    );
    try {
        const trace: CopilotToolCallTrace[] = [];
        const tools = await makeCopilotTools(repo, trace);
        const grep = requiredTool(tools, "grep");
        const read = requiredTool(tools, "read");
        await assert.rejects(
            async () =>
                await grep.handler!(
                    { pattern: "x".repeat(10_000) },
                    invocation,
                ),
            /pattern is too long/i,
        );
        await assert.rejects(
            async () =>
                await read.handler!({ path: "x".repeat(20_000) }, invocation),
        );

        assert.ok(JSON.stringify(trace[0].args).length <= 3_000);
        assert.ok(trace[1].output.length <= 12_000);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

test("stops executing tools after the shared call budget", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-budget-"),
    );
    try {
        await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
        const trace: CopilotToolCallTrace[] = [];
        const tools = await makeCopilotTools(repo, trace, 1);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");

        const readPromise = read.handler!({ path: "README.md" }, invocation);
        assert.equal(
            await grep.handler!({ pattern: "fixture" }, invocation),
            "TOOL_BUDGET_EXHAUSTED: answer now using the evidence already gathered.",
        );
        assert.match(String(await readPromise), /fixture/);
        assert.equal(trace.length, 2);
        const exhausted = trace.find((entry) =>
            entry.output.startsWith("TOOL_BUDGET_EXHAUSTED"),
        );
        assert.equal(exhausted?.tool, "grep");
        assert.equal(exhausted?.ok, true);
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});
