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

async function createAgentScaffold(
    repoRoot: string,
    agent: string,
): Promise<void> {
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
    await write(
        path.join(src, "schema.ts"),
        "export type X = { kind: string };\n",
    );
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
        JSON.stringify({ agents: { [agent]: { name: agent } } }, null, 2) +
            "\n",
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

    it("uses package.json exports to locate the handler when present", async () => {
        // Mirror real agents (e.g. browser, calendar) that use a non-standard
        // handler filename declared via `exports["./agent/handlers"]`. The
        // permissive filename heuristic would also pick this up, but the
        // declared-entry path is what the dispatcher actually resolves, so
        // we exercise it explicitly.
        await createAgentScaffold(repoRoot, "exported");
        const pkgDir = path.join(repoRoot, "packages", "agents", "exported");
        // Remove the conventional handler so only the declared one exists.
        await fs.rm(path.join(pkgDir, "src", "exportedActionHandler.ts"));
        await write(
            path.join(pkgDir, "src", "agent", "weirdName.ts"),
            "export function instantiate() { return {}; }\n",
        );
        await write(
            path.join(pkgDir, "package.json"),
            JSON.stringify(
                {
                    name: "exported",
                    exports: {
                        "./agent/manifest": "./src/exportedManifest.json",
                        "./agent/handlers": "./dist/agent/weirdName.js",
                    },
                },
                null,
                2,
            ) + "\n",
        );

        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("exported");
        expect(
            findings.some((f) => f.ruleId === "handler.exports.instantiate"),
        ).toBe(false);
    });

    it("does not warn about missing grammar when the manifest marks the schema as injected", async () => {
        // Chat-style fallback agents declare `schema.injected: true` in their
        // manifest because they're invoked when no grammar matches; warning
        // about the missing grammar is a false positive for them.
        await createAgentScaffold(repoRoot, "chatlike");
        const src = path.join(repoRoot, "packages", "agents", "chatlike", "src");
        // Drop the grammar so the rule has something to potentially warn about.
        await fs.rm(path.join(src, "schema.agr"));
        await write(
            path.join(src, "chatlikeManifest.json"),
            JSON.stringify(
                {
                    name: "chatlike",
                    schema: {
                        originalSchemaFile: "./schema.ts",
                        schemaFile: "./schema.json",
                        injected: true,
                    },
                },
                null,
                2,
            ) + "\n",
        );

        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("chatlike");
        expect(
            findings.some(
                (f) => f.ruleId === "schema.actions.haveGrammar",
            ),
        ).toBe(false);
    });

    it("returns no findings for a healthy minimal agent", async () => {
        await createAgentScaffold(repoRoot, "demo");
        const svc = new FileHealthService({ repoRoot });
        const findings = await svc.check("demo");
        expect(findings).toEqual([]);
    });

    it("recognizes handler files that don't follow the *ActionHandler.ts naming convention", async () => {
        // Some bundled agents (player, scaffolder, list/chatResponse) name
        // their handler files differently — e.g. `playerHandlers.ts`,
        // `scaffolderHandler.ts`, `chatResponseHandler.ts`. Discovery must
        // accept any `*Handler.ts` / `*Handlers.ts` / `*.mts` variant so the
        // handler.exports.instantiate rule doesn't fire spuriously.
        const variants: { agent: string; handlerFileName: string }[] = [
            { agent: "playerlike", handlerFileName: "playerlikeHandlers.ts" },
            { agent: "responder", handlerFileName: "chatResponseHandler.ts" },
            { agent: "scaffolderlike", handlerFileName: "scaffolderHandler.ts" },
            { agent: "browserlike", handlerFileName: "browserlikeActionHandler.mts" },
            { agent: "calendarlike", handlerFileName: "calendarlikeActionHandlerV3.ts" },
        ];

        for (const { agent, handlerFileName } of variants) {
            await createAgentScaffold(repoRoot, agent);
            const src = path.join(repoRoot, "packages", "agents", agent, "src");
            // Replace the default *ActionHandler.ts with the variant name.
            await fs.rm(path.join(src, `${agent}ActionHandler.ts`));
            await write(
                path.join(src, handlerFileName),
                "export function instantiate() { return {}; }\n",
            );

            const svc = new FileHealthService({ repoRoot });
            const findings = await svc.check(agent);
            expect(
                findings.some(
                    (f) => f.ruleId === "handler.exports.instantiate",
                ),
            ).toBe(false);
        }
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
            JSON.stringify({ agents: { demo: { name: "demo" } } }, null, 2) +
                "\n",
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
        expect(findings.some((f) => f.ruleId === "provider.registers")).toBe(
            true,
        );
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
