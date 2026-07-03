// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getSourceCommands } from "../src/installSources/sourceCommands.js";

// `getSourceCommands` is the host's full `@source` table (list / order / where
// / remove / add). The dispatcher core merges it in verbatim via
// `InstalledAgentSourceApi.sourceCommands()` and knows none of this grammar. Here we
// drive each handler directly with already-parsed params against a fake
// registry, asserting the registry calls (and rendered text where it matters).

// A fake registry covering the surface the @source handlers touch. `list`
// returns the opaque `InstallSourceInfo` the handlers render; `where` reports
// the would-be resolution candidate. Calls are recorded on `calls` so tests
// can assert against them without depending on a mock framework.
function makeRegistry(overrides: any = {}) {
    const infos = overrides.infos ?? [
        { name: "path", kind: "path", detail: "(default base)" },
    ];
    const orderNames = overrides.order ?? infos.map((c: any) => c.name);
    const calls: { setOrder: string[][]; remove: string[]; where: string[] } = {
        setOrder: [],
        remove: [],
        where: [],
    };
    const registry = {
        calls,
        list: () => infos,
        order: () => orderNames.map((name: string) => ({ name, kind: "path" })),
        setOrder: (names: string[]) => calls.setOrder.push(names),
        remove: (name: string) => calls.remove.push(name),
        get: (name: string) =>
            overrides.agents
                ? { listAgents: async () => overrides.agents[name] ?? [] }
                : undefined,
        add: () => {},
        resolve: async () => undefined,
        where: async (ref: string) => {
            calls.where.push(ref);
            return overrides.where ? overrides.where(ref) : undefined;
        },
    } as any;
    return registry;
}

function makeDeps(registry: any, recordsUsingSource?: any) {
    return {
        registry,
        recordsUsingSource: recordsUsingSource ?? (() => [] as string[]),
    };
}

// Minimal ActionContext (displayResult/displayWarn only need appendDisplay).
function fakeContext(): any {
    return {
        actionIO: {
            appendDisplay: () => {},
            setDisplay: () => {},
            takeAction: () => {},
        },
    };
}

// Like fakeContext but captures every appendDisplay payload as text so tests
// can assert rendered output (displayResult appends a string; displayWarn
// appends a { content } object).
function capturingContext(): { context: any; output: () => string } {
    const captured: string[] = [];
    const context = {
        actionIO: {
            appendDisplay: (content: any) => {
                captured.push(
                    typeof content === "string"
                        ? content
                        : Array.isArray(content?.content)
                          ? content.content
                                .map((row: string[]) => row.join(" "))
                                .join("\n")
                          : (content?.content ?? JSON.stringify(content)),
                );
            },
            setDisplay: () => {},
            takeAction: () => {},
        },
    };
    return { context, output: () => captured.join("\n") };
}

describe("getSourceCommands", () => {
    it("exposes list, order, where, remove, and add subcommands", () => {
        const table = getSourceCommands(makeDeps(makeRegistry()));
        expect(Object.keys(table.commands).sort()).toEqual([
            "add",
            "list",
            "order",
            "remove",
            "where",
        ]);
        expect(table.defaultSubCommand).toBe("list");
    });

    describe("list", () => {
        it("reports the configured sources in resolution order", async () => {
            const registry = makeRegistry();
            const list = getSourceCommands(makeDeps(registry)).commands
                .list as any;
            const { context, output } = capturingContext();
            await list.run(context);
            expect(output()).toContain("#1 path path (default base)");
        });

        it("renders the order and each source with its position", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    {
                        name: "typeagent",
                        kind: "feed",
                        detail: "https://feed.example.com/",
                    },
                ],
                order: ["path", "typeagent"],
            });
            const list = getSourceCommands(makeDeps(registry)).commands
                .list as any;
            const { context, output } = capturingContext();
            await list.run(context);
            const text = output();
            expect(text).toContain("#1 path path (default base)");
            expect(text).toContain(
                "#2 typeagent feed https://feed.example.com/",
            );
        });
    });

    describe("order", () => {
        it("forwards the requested names to the registry", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
                order: ["builtin", "path"],
            });
            const order = getSourceCommands(makeDeps(registry)).commands
                .order as any;
            await order.run(fakeContext(), { args: { names: ["builtin"] } });
            expect(registry.calls.setOrder).toEqual([["builtin"]]);
        });

        it("warns on an unknown source name but still forwards", async () => {
            const registry = makeRegistry();
            const order = getSourceCommands(makeDeps(registry)).commands
                .order as any;
            const { context, output } = capturingContext();
            await order.run(context, {
                args: { names: ["nope", "path"] },
            });
            expect(output()).toContain("Ignoring unknown source(s): nope");
            expect(registry.calls.setOrder).toEqual([["nope", "path"]]);
        });

        it("forwards an empty list unchanged", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
                order: ["path", "builtin"],
            });
            const order = getSourceCommands(makeDeps(registry)).commands
                .order as any;
            await order.run(fakeContext(), { args: { names: [] } });
            expect(registry.calls.setOrder).toEqual([[]]);
        });

        it("completes names with configured source names", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
            });
            const order = getSourceCommands(makeDeps(registry)).commands
                .order as any;
            const result = await order.getCompletion({}, {}, ["names"]);
            expect(result.groups).toEqual([
                { name: "names", completions: ["path", "builtin"] },
            ]);
        });

        it("excludes names already entered", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
            });
            const order = getSourceCommands(makeDeps(registry)).commands
                .order as any;
            const result = await order.getCompletion(
                {},
                { args: { names: ["path"] } },
                ["names"],
            );
            expect(result.groups).toEqual([
                { name: "names", completions: ["builtin"] },
            ]);
        });
    });

    describe("where", () => {
        it("reports the resolving source without installing", async () => {
            const registry = makeRegistry({
                where: () => ({ source: "path", path: "/some/path" }),
            });
            const where = getSourceCommands(makeDeps(registry)).commands
                .where as any;
            const { context, output } = capturingContext();
            await where.run(context, { args: { ref: "/some/path" } });
            expect(registry.calls.where).toEqual(["/some/path"]);
            expect(output()).toContain("source 'path'");
        });

        it("reports when no source would resolve the ref", async () => {
            const registry = makeRegistry({ order: ["path"] });
            const where = getSourceCommands(makeDeps(registry)).commands
                .where as any;
            const { context, output } = capturingContext();
            await where.run(context, { args: { ref: "nope" } });
            expect(output()).toContain("No source would resolve 'nope'");
        });

        it("completes ref with de-duplicated enumerable agent names", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "feed", kind: "feed", detail: "<feed>" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
                agents: { feed: ["foo", "bar"], builtin: ["bar", "baz"] },
            });
            const where = getSourceCommands(makeDeps(registry)).commands
                .where as any;
            const result = await where.getCompletion({}, {}, ["ref"]);
            expect(result.groups).toEqual([
                { name: "ref", completions: ["foo", "bar", "baz"] },
            ]);
        });
    });

    describe("remove", () => {
        it("warns and aborts when a source is still referenced", async () => {
            const registry = makeRegistry();
            const remove = getSourceCommands(
                makeDeps(registry, () => ["a", "b"]),
            ).commands.remove as any;
            await remove.run(fakeContext(), {
                args: { name: "path" },
                flags: { force: false },
            });
            expect(registry.calls.remove).toEqual([]);
        });

        it("proceeds with --force despite references", async () => {
            const registry = makeRegistry();
            const remove = getSourceCommands(makeDeps(registry, () => ["a"]))
                .commands.remove as any;
            await remove.run(fakeContext(), {
                args: { name: "path" },
                flags: { force: true },
            });
            expect(registry.calls.remove).toEqual(["path"]);
        });

        it("proceeds when nothing references the source", async () => {
            const registry = makeRegistry();
            const remove = getSourceCommands(makeDeps(registry, () => []))
                .commands.remove as any;
            await remove.run(fakeContext(), {
                args: { name: "path" },
                flags: { force: false },
            });
            expect(registry.calls.remove).toEqual(["path"]);
        });

        it("completes name with configured source names", async () => {
            const registry = makeRegistry({
                infos: [
                    { name: "path", kind: "path", detail: "(default base)" },
                    { name: "builtin", kind: "catalog", detail: "<bundled>" },
                ],
            });
            const remove = getSourceCommands(makeDeps(registry)).commands
                .remove as any;
            const result = await remove.getCompletion({}, {}, ["name"]);
            expect(result.groups).toEqual([
                { name: "name", completions: ["path", "builtin"] },
            ]);
        });
    });
});
