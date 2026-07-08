// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAddSourceCommandHandlers } from "../src/installSources/addSource.js";

// `getAddSourceCommandHandlers` owns the per-kind `@package source add` grammar +
// validation. The dispatcher core merges these typed handlers into `@package source`
// (via `InstalledAgentSourceApi.sourceCommands`) and parses the args/flags; here we
// invoke each handler directly with already-parsed params and assert the
// config it hands to `registry.add` (or the validation error it throws).

// Minimal fake registry capturing the configs the handlers add.
function makeRegistry() {
    const added: any[] = [];
    return {
        added,
        registry: {
            add: (config: any) => added.push(config),
        } as any,
    };
}

// Minimal ActionContext: displayResult only needs actionIO.appendDisplay.
function fakeContext(): any {
    return {
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    };
}

// Run a handler and return the single config it added.
async function run(
    kind: "feed" | "catalog" | "path",
    args: any,
    flags: any = {},
) {
    const { added, registry } = makeRegistry();
    const handlers = getAddSourceCommandHandlers(registry);
    const handler = handlers.commands[kind] as any;
    await handler.run(fakeContext(), { args, flags });
    return added[0];
}

// Run a handler expecting it to throw.
function runExpectThrow(
    kind: "feed" | "catalog" | "path",
    args: any,
    flags: any = {},
) {
    const { registry } = makeRegistry();
    const handlers = getAddSourceCommandHandlers(registry);
    const handler = handlers.commands[kind] as any;
    return handler.run(fakeContext(), { args, flags });
}

describe("getAddSourceCommandHandlers", () => {
    it("exposes feed, catalog, and path subcommands", () => {
        const { registry } = makeRegistry();
        const handlers = getAddSourceCommandHandlers(registry);
        expect(Object.keys(handlers.commands).sort()).toEqual([
            "catalog",
            "feed",
            "path",
        ]);
    });

    describe("feed", () => {
        it("allows an env-backed registry (no url)", async () => {
            expect(
                await run("feed", { name: "f" }, { registry: undefined }),
            ).toEqual({
                kind: "feed",
                name: "f",
            });
        });

        it("rejects a non-https url", async () => {
            await expect(
                runExpectThrow(
                    "feed",
                    { name: "f" },
                    { registry: "http://example.com/feed" },
                ),
            ).rejects.toThrow(/https/);
        });

        it("rejects a malformed url", async () => {
            await expect(
                runExpectThrow(
                    "feed",
                    { name: "f" },
                    { registry: "not-a-url" },
                ),
            ).rejects.toThrow(/well-formed URL/);
        });

        it("builds a well-formed feed config with repeatable scopes", async () => {
            expect(
                await run(
                    "feed",
                    { name: "f" },
                    {
                        registry: "https://pkgs.example.com/feed/",
                        scope: ["@a", "@b"],
                    },
                ),
            ).toEqual({
                kind: "feed",
                name: "f",
                registry: "https://pkgs.example.com/feed/",
                scopes: ["@a", "@b"],
            });
        });

        it("omits scopes when none given", async () => {
            expect(
                await run(
                    "feed",
                    { name: "f" },
                    { registry: "https://pkgs.example.com/feed/" },
                ),
            ).toEqual({
                kind: "feed",
                name: "f",
                registry: "https://pkgs.example.com/feed/",
            });
        });
    });

    describe("path", () => {
        it("builds a path config without a baseDir", async () => {
            expect(await run("path", { name: "local" })).toEqual({
                kind: "path",
                name: "local",
            });
        });

        it("builds a path config with an optional normalized absolute baseDir", async () => {
            expect(
                await run("path", { name: "local" }, { baseDir: "/agents" }),
            ).toEqual({
                kind: "path",
                name: "local",
                baseDir: path.resolve("/agents"),
            });
        });

        it("does not expand env/home in baseDir before persisting", async () => {
            const envVar = "TA_ADD_PATH_BASEDIR";
            const prev = process.env[envVar];
            const base = fs.mkdtempSync(path.join(os.tmpdir(), "ta-path-add-"));
            process.env[envVar] = base;
            try {
                expect(
                    await run(
                        "path",
                        { name: "local" },
                        { baseDir: `\${${envVar}}/agents` },
                    ),
                ).toEqual({
                    kind: "path",
                    name: "local",
                    baseDir: path.resolve(`\${${envVar}}/agents`),
                });
            } finally {
                if (prev === undefined) {
                    delete process.env[envVar];
                } else {
                    process.env[envVar] = prev;
                }
            }
        });

        it("expands home in baseDir before persisting", async () => {
            const base = fs.mkdtempSync(
                path.join(os.homedir(), "ta-path-home-"),
            );
            const relFromHome = path.relative(os.homedir(), base);
            const withTilde = path.join("~", relFromHome);
            expect(
                await run("path", { name: "local" }, { baseDir: withTilde }),
            ).toEqual({
                kind: "path",
                name: "local",
                baseDir: path.resolve(base),
            });
        });
    });

    describe("catalog", () => {
        it("requires a catalog path", async () => {
            await expect(
                runExpectThrow(
                    "catalog",
                    { name: "c" },
                    { catalog: undefined },
                ),
            ).rejects.toThrow(/--catalog/);
        });

        it("registers a source for a readable JSON file", async () => {
            const file = path.join(
                fs.mkdtempSync(path.join(os.tmpdir(), "ta-cat-")),
                "catalog.json",
            );
            fs.writeFileSync(file, JSON.stringify({ agents: {} }));
            expect(
                await run("catalog", { name: "c" }, { catalog: file }),
            ).toEqual({
                kind: "catalog",
                name: "c",
                catalog: path.resolve(file),
            });
        });

        it("does not expand env in catalog path before validating", async () => {
            const envVar = "TA_ADD_CATALOG_DIR";
            const prev = process.env[envVar];
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-cat-env-"));
            const file = path.join(dir, "catalog.json");
            fs.writeFileSync(file, JSON.stringify({ agents: {} }));
            process.env[envVar] = dir;
            try {
                await expect(
                    runExpectThrow(
                        "catalog",
                        { name: "c" },
                        { catalog: `\${${envVar}}/catalog.json` },
                    ),
                ).rejects.toThrow(/not accessible/);
            } finally {
                if (prev === undefined) {
                    delete process.env[envVar];
                } else {
                    process.env[envVar] = prev;
                }
            }
        });

        it("expands home in catalog path before validating", async () => {
            const dir = fs.mkdtempSync(path.join(os.homedir(), "ta-cat-home-"));
            const file = path.join(dir, "catalog.json");
            fs.writeFileSync(file, JSON.stringify({ agents: {} }));
            const relFromHome = path.relative(os.homedir(), file);
            const withTilde = path.join("~", relFromHome);
            expect(
                await run("catalog", { name: "c" }, { catalog: withTilde }),
            ).toEqual({
                kind: "catalog",
                name: "c",
                catalog: path.resolve(file),
            });
        });

        it("reports an inaccessible file distinctly from bad JSON", async () => {
            const missing = path.join(
                os.tmpdir(),
                "ta-no-such-catalog-xyz.json",
            );
            await expect(
                runExpectThrow("catalog", { name: "c" }, { catalog: missing }),
            ).rejects.toThrow(/not accessible/);
        });

        it("rejects a file that is not valid JSON", async () => {
            const file = path.join(
                fs.mkdtempSync(path.join(os.tmpdir(), "ta-cat-")),
                "catalog.json",
            );
            fs.writeFileSync(file, "{ not json");
            await expect(
                runExpectThrow("catalog", { name: "c" }, { catalog: file }),
            ).rejects.toThrow(/not valid JSON/);
        });

        it("accepts a catalog path containing spaces", async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta cat "));
            const file = path.join(dir, "catalog.json");
            fs.writeFileSync(file, JSON.stringify({ agents: {} }));
            expect(
                await run("catalog", { name: "c" }, { catalog: file }),
            ).toEqual({
                kind: "catalog",
                name: "c",
                catalog: path.resolve(file),
            });
        });
    });
});
