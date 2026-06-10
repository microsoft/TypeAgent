// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    createRepoAgentLoader,
    resolveAgentName,
    summarizeFindingsToHealth,
} from "../src/sandbox/index.js";
import type { HealthFinding } from "../src/health/index.js";

async function mkTempRepo(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-core-loader-"));
}

async function write(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
}

async function createHealthyAgent(
    repoRoot: string,
    agent: string,
): Promise<void> {
    const src = path.join(repoRoot, "packages", "agents", agent, "src");
    await write(
        path.join(src, `${agent}Manifest.json`),
        JSON.stringify({ name: agent, schema: {} }, null, 2) + "\n",
    );
    await write(
        path.join(src, "schema.ts"),
        "export type X = { kind: string };\n",
    );
    await write(path.join(src, "schema.agr"), "[A] => action\n");
    await write(
        path.join(src, `${agent}ActionHandler.ts`),
        "export function instantiate() { return {}; }\n",
    );
    await write(
        path.join(
            repoRoot,
            "packages",
            "defaultAgentProvider",
            "data",
            "config.json",
        ),
        JSON.stringify({ agents: { [agent]: { name: agent } } }, null, 2) +
            "\n",
    );
}

function finding(severity: HealthFinding["severity"]): HealthFinding {
    return {
        ruleId: "test.rule",
        severity,
        agent: "test",
        evidence: { message: "test" },
    };
}

describe("resolveAgentName", () => {
    it("returns a bare name unchanged", () => {
        expect(resolveAgentName("player")).toBe("player");
    });

    it("extracts the name from a packages/agents path", () => {
        expect(
            resolveAgentName("C:/repo/ts/packages/agents/calendar/src"),
        ).toBe("calendar");
    });

    it("extracts the name from a Windows-style packages/agents path", () => {
        expect(resolveAgentName("C:\\repo\\ts\\packages\\agents\\email")).toBe(
            "email",
        );
    });

    it("falls back to the basename without extension", () => {
        expect(resolveAgentName("/some/dir/list.json")).toBe("list");
    });

    it("ignores a trailing slash", () => {
        expect(resolveAgentName("packages/agents/photo/")).toBe("photo");
    });
});

describe("summarizeFindingsToHealth", () => {
    it("is healthy with no findings", () => {
        expect(summarizeFindingsToHealth([])).toBe("healthy");
    });

    it("is warning when only warnings are present", () => {
        expect(
            summarizeFindingsToHealth([finding("info"), finding("warning")]),
        ).toBe("warning");
    });

    it("is error when any error is present", () => {
        expect(
            summarizeFindingsToHealth([finding("warning"), finding("error")]),
        ).toBe("error");
    });
});

describe("createRepoAgentLoader", () => {
    let repoRoot: string;

    beforeEach(async () => {
        repoRoot = await mkTempRepo();
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
    });

    it("computes real schema and grammar hashes for an agent on disk", async () => {
        await createHealthyAgent(repoRoot, "alpha");
        const loader = createRepoAgentLoader({ repoRoot });

        const info = await loader("sbx", "alpha");

        expect(info.name).toBe("alpha");
        expect(info.sourcePath).toBe("alpha");
        expect(info.schemaHash).toMatch(/^[0-9a-f]{64}$/);
        expect(info.grammarHash).toMatch(/^[0-9a-f]{64}$/);
        expect(info.schemaHash).not.toBe(info.grammarHash);
        expect(info.health).toBe("healthy");
    });

    it("changes the schema hash when the schema content changes", async () => {
        await createHealthyAgent(repoRoot, "beta");
        const loader = createRepoAgentLoader({ repoRoot });
        const before = await loader("sbx", "beta");

        await write(
            path.join(
                repoRoot,
                "packages",
                "agents",
                "beta",
                "src",
                "schema.ts",
            ),
            "export type X = { kind: string; extra: number };\n",
        );
        const after = await loader("sbx", "beta");

        expect(after.schemaHash).not.toBe(before.schemaHash);
        expect(after.grammarHash).toBe(before.grammarHash);
    });

    it("reports unknown health and sentinel hashes for a missing agent", async () => {
        const loader = createRepoAgentLoader({ repoRoot });

        const info = await loader("sbx", "does-not-exist");

        expect(info.health).toBe("unknown");
        expect(info.schemaHash).toBe("none");
        expect(info.grammarHash).toBe("none");
    });

    it("delegates health assessment to the injected health service", async () => {
        await createHealthyAgent(repoRoot, "gamma");
        const loader = createRepoAgentLoader({
            repoRoot,
            healthService: {
                rules: () => [],
                check: async () => [finding("error")],
            },
        });

        const info = await loader("sbx", "gamma");

        expect(info.health).toBe("error");
    });
});
