// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    access,
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Tool, ToolInvocation } from "@github/copilot-sdk";
import { createRepositoryTools } from "explorer-typeagent";
import { createCopilotExplorationTools } from "../src/copilotTools.js";
import { resolvePackagedRipgrepPath } from "../src/ripgrep.js";
import type { CopilotToolCallTrace } from "../src/types.js";

const invocation: ToolInvocation = {
    sessionId: "test-session",
    toolCallId: "test-tool-call",
    toolName: "test-tool",
    arguments: {},
};

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
        const tools = await createCopilotExplorationTools(repo, trace);

        assert.deepEqual(
            tools.map((tool) => tool.name),
            ["read", "grep", "glob", "bash"],
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
        const copilotTools = await createCopilotExplorationTools(
            repo,
            [],
            10,
            packagedRipgrepPath,
        );
        const copilotGrep = requiredTool(copilotTools, "grep");
        const typeAgent = await createRepositoryTools({
            repoRoot: repo,
            maxCalls: 10,
            ripgrepPath: packagedRipgrepPath,
        });
        try {
            for (const args of [
                { pattern: "needle", maxMatches: 3 },
                { pattern: "a.*b", literal: true },
                { pattern: "needle" },
                { pattern: "needle", maxMatches: 999 },
            ]) {
                const copilot = parseCopilotGrepOutput(
                    String(await copilotGrep.handler!(args, invocation)),
                );
                const typeAgentMatches = await typeAgent.api.grep(
                    args.pattern,
                    args,
                );
                assert.deepEqual(typeAgentMatches, copilot);
            }
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
        } finally {
            await typeAgent.close();
        }
    } finally {
        await rm(repo, { recursive: true, force: true });
    }
});

function parseCopilotGrepOutput(
    output: string,
): Array<{ path: string; line: number; text: string }> {
    if (output === "No matches") return [];
    return output.split("\n").map((line) => {
        const match = /^(.*?):(\d+):(.*)$/u.exec(line);
        assert.ok(match, `unexpected Copilot grep line: ${line}`);
        return { path: match[1], line: Number(match[2]), text: match[3] };
    });
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

        const tools = await createCopilotExplorationTools(repo, []);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");
        const glob = requiredTool(tools, "glob");
        const bash = requiredTool(tools, "bash");

        await assert.rejects(
            async () =>
                await read.handler!({ path: "../outside.txt" }, invocation),
            /Path escapes repo root/,
        );
        await assert.rejects(
            async () => await read.handler!({ path: "escape.txt" }, invocation),
            /Path escapes repo root/,
        );
        await assert.rejects(
            async () =>
                await grep.handler!(
                    { pattern: "outside", path: ".." },
                    invocation,
                ),
            /Path escapes repo root/,
        );
        await assert.rejects(
            async () => await glob.handler!({ pattern: "../*" }, invocation),
            /repository-relative/i,
        );
        await assert.rejects(
            async () =>
                await bash.handler!({ command: "pwd", cwd: ".." }, invocation),
            /Path escapes repo root/,
        );
    } finally {
        await rm(parent, { recursive: true, force: true });
    }
});

test("rejects secret files and unsafe shell commands and scrubs process secrets", async () => {
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
        const tools = await createCopilotExplorationTools(repo, trace, 50);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");
        const bash = requiredTool(tools, "bash");

        await assert.rejects(
            async () => await read.handler!({ path: ".env" }, invocation),
            /Refusing to read likely secret file/,
        );
        await assert.rejects(
            async () => await read.handler!({ path: ".npmrc" }, invocation),
            /Refusing to read likely secret file/,
        );
        await assert.rejects(
            async () =>
                await read.handler!({ path: "private.pem" }, invocation),
            /Refusing to read likely secret file/,
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
        await assert.rejects(
            async () =>
                await bash.handler!(
                    { command: `printenv ${secretName}` },
                    invocation,
                ),
            /Rejected unsafe command/,
        );
        await assert.rejects(
            async () =>
                await bash.handler!({ command: "cat .env" }, invocation),
            /Rejected unsafe command/,
        );
        await assert.rejects(
            async () =>
                await bash.handler!(
                    { command: "echo changed > tracked.txt" },
                    invocation,
                ),
            /Rejected unsafe command/,
        );
        await assert.rejects(
            async () =>
                await bash.handler!(
                    { command: "find / -name README.md" },
                    invocation,
                ),
            /Rejected unsafe command/,
        );

        assert.equal(trace.filter((entry) => !entry.ok).length, 7);
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

test("bash directly spawns only allowlisted read-only repository commands", async () => {
    const parent = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-bash-safe-"),
    );
    const repo = path.join(parent, "repo");
    try {
        await mkdir(repo);
        await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
        await writeFile(path.join(parent, "outside.txt"), "outside\n", "utf8");
        await symlink(parent, path.join(repo, "outside-link"));

        const tools = await createCopilotExplorationTools(repo, [], 50);
        const bash = requiredTool(tools, "bash");
        assert.match(
            String(await bash.handler!({ command: "pwd" }, invocation)),
            /repo/,
        );
        assert.match(
            String(await bash.handler!({ command: "ls ." }, invocation)),
            /README\.md/,
        );
        assert.match(
            String(
                await bash.handler!(
                    { command: "find . -maxdepth 1 -type f" },
                    invocation,
                ),
            ),
            /README\.md/,
        );

        for (const command of [
            "cat ../outside.txt",
            "cat ~/.ssh/id_rsa",
            "git branch exploit",
            "git config user.name changed",
            "perl -e 'unlink README.md'",
            "echo changed>tracked.txt",
            "ls /",
            "ls -RL .",
            "ls --dereference -R .",
            "find -L . -type f",
            "find . -follow -type f",
            "git grep fixture",
            "ls $(pwd)",
            "ls . | head",
        ]) {
            await assert.rejects(
                async () => await bash.handler!({ command }, invocation),
                /Rejected unsafe command/,
                command,
            );
        }
        await assert.rejects(access(path.join(repo, "tracked.txt")));
        assert.equal(
            await readFile(path.join(repo, "README.md"), "utf8"),
            "fixture\n",
        );
    } finally {
        await rm(parent, { recursive: true, force: true });
    }
});

test("bash ignores malicious PATH and current-repository command shadows", async () => {
    const repo = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-copilot-path-shadow-"),
    );
    const savedPath = process.env.PATH;
    try {
        await writeFile(path.join(repo, "README.md"), "fixture\n", "utf8");
        await writeFile(
            path.join(repo, "ls"),
            "#!/bin/sh\necho MALICIOUS_PATH_SHADOW_EXECUTED\n",
            "utf8",
        );
        await chmod(path.join(repo, "ls"), 0o755);
        process.env.PATH = [".", repo, savedPath]
            .filter(Boolean)
            .join(path.delimiter);

        const tools = await createCopilotExplorationTools(repo, [], 50);
        const bash = requiredTool(tools, "bash");
        const output = String(
            await bash.handler!({ command: "ls ." }, invocation),
        );
        assert.match(output, /README\.md/);
        assert.doesNotMatch(output, /MALICIOUS_PATH_SHADOW_EXECUTED/);
    } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
        await rm(repo, { recursive: true, force: true });
    }
});

test("bounds read, grep, glob, and bash output", async () => {
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

        const tools = await createCopilotExplorationTools(repo, []);
        const read = requiredTool(tools, "read");
        const grep = requiredTool(tools, "grep");
        const glob = requiredTool(tools, "glob");
        const bash = requiredTool(tools, "bash");

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
            /1 MiB read limit/,
        );

        const grepLines = String(
            await grep.handler!(
                { pattern: "match-", path: "large.txt", maxMatches: 9_999 },
                invocation,
            ),
        ).split("\n");
        assert.equal(grepLines.length, 200);

        const globLines = String(
            await glob.handler!(
                { pattern: "*.txt", maxMatches: 200 },
                invocation,
            ),
        ).split("\n");
        assert.equal(globLines.length, 200);

        const bashOutput = String(
            await bash.handler!(
                { command: "find . -maxdepth 1 -type f", timeoutMs: 10_000 },
                invocation,
            ),
        );
        assert.ok(bashOutput.length <= 12_007);
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
        const tools = await createCopilotExplorationTools(repo, trace);
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
        const tools = await createCopilotExplorationTools(repo, trace);
        const grep = requiredTool(tools, "grep");
        const read = requiredTool(tools, "read");
        await grep.handler!({ pattern: "x".repeat(10_000) }, invocation);
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
        const tools = await createCopilotExplorationTools(repo, trace, 1);
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
