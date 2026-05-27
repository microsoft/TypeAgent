// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { FileHealthService } from "../src/health/index.js";

async function mkTempRepo(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "typeagent-core-health-"));
}

async function write(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
}

async function createAgentScaffold(repoRoot: string, agent: string): Promise<void> {
    const src = path.join(repoRoot, "packages", "agents", agent, "src");
    await write(
        path.join(src, `${agent}Manifest.json`),
        JSON.stringify(
            {
                name: agent,
                schema: {
                    originalSchemaFile: "./schema.ts",
                    schemaFile: "./schema.json",
                    grammarFile: "./schema.agr",
                },
            },
            null,
            2,
        ) + "\n",
    );
    await write(path.join(src, "schema.ts"), "export type X = { kind: string };\n");
    await write(path.join(src, "schema.json"), '{"actions":["a"]}\n');
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
        JSON.stringify({ agents: { [agent]: { name: agent } } }, null, 2) + "\n",
    );
}

describe("FileHealthService", () => {
    let repoRoot: string;

    beforeEach(async () => {
        repoRoot = await mkTempRepo();
    });

    afterEach(async () => {
        await fs.rm(repoRoot, { recursive: true, force: true });
    });

    it("registers all 11 MVP rule ids", () => {
        const svc = new FileHealthService({ repoRoot });
        const ids = svc.rules().map((r) => r.id);
        expect(ids).toEqual([
            "manifest.parses",
            "manifest.name.matches",
            "manifest.schemaPath.exists",
            "schema.parses",
            "schema.actions.haveGrammar",
            "grammar.parses",
            "grammar.rules.targetKnownActions",
            "handler.exports.instantiate",
            "provider.registers",
            "actions.unique.acrossLoaded",
            "cache.compatible",
        ]);
    });

    it("returns no findings for a healthy minimal agent", async () => {
        await createAgentScaffold(repoRoot, "demo");
        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("demo");
        expect(findings).toEqual([]);
    });

    it("reports manifest.parses error for malformed manifest JSON", async () => {
        const src = path.join(repoRoot, "packages", "agents", "demo", "src");
        await write(path.join(src, "demoManifest.json"), "{not-json}\n");
        await write(
            path.join(
                repoRoot,
                "packages",
                "defaultAgentProvider",
                "data",
                "config.json",
            ),
            JSON.stringify({ agents: { demo: { name: "demo" } } }, null, 2) + "\n",
        );
        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("demo");
        expect(findings.some((f) => f.ruleId === "manifest.parses")).toBe(true);
    });

    it("reports provider.registers when agent is missing from default config", async () => {
        await createAgentScaffold(repoRoot, "demo");
        await write(
            path.join(
                repoRoot,
                "packages",
                "defaultAgentProvider",
                "data",
                "config.json",
            ),
            JSON.stringify({ agents: {} }, null, 2) + "\n",
        );
        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("demo");
        expect(
            findings.some((f) => f.ruleId === "provider.registers"),
        ).toBe(true);
    });

    it("reports actions.unique.acrossLoaded warning for duplicate action types", async () => {
        await createAgentScaffold(repoRoot, "demo");
        const svc = new FileHealthService({
            repoRoot,
            loadedActionTypes: {
                demo: ["calendar.scheduleEvent"],
                other: ["calendar.scheduleEvent"],
            },
        });
        const findings = await svc.check("demo");
        const hit = findings.find(
            (f) => f.ruleId === "actions.unique.acrossLoaded",
        );
        expect(hit?.severity).toBe("warning");
    });

    it("reports cache.compatible info when schema hash mismatches", async () => {
        await createAgentScaffold(repoRoot, "demo");
        const svc = new FileHealthService({
            repoRoot,
            cacheSchemaHash: "deadbeef",
        });
        const findings = await svc.check("demo");
        const hit = findings.find((f) => f.ruleId === "cache.compatible");
        expect(hit?.severity).toBe("info");
    });
});
