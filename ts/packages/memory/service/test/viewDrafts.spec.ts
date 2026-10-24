// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git from "isomorphic-git";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { runMemoryViewsCli } from "../src/memoryViewsCli.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { ViewHistory, type ViewHistoryFaultPoint } from "../src/viewHistory.js";
import type { ViewSaveRequest } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { parseViewDraftCapability } from "../src/viewBuildValidation.js";

describe("typed draft views: service, history, privacy and CLI", () => {
    let root: string;
    let service: FileMemoryService;
    const open = (enabled?: boolean) =>
        new FileMemoryService(root, {
            ...(enabled === undefined ? {} : { viewDrafts: enabled }),
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-view-drafts-"));
        service = open();
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    test("Views and all builders are enabled without configuration", async () => {
        expect(parseViewDraftCapability(undefined)).toBe(true);
        expect(parseViewDraftCapability("true")).toBe(true);
        expect(parseViewDraftCapability("false")).toBe(false);
        expect(() => parseViewDraftCapability("invalid")).toThrow(
            "must be true or false",
        );
        expect((await service.getCapabilities()).derivedViews).toMatchObject({
            drafts: true,
            builds: true,
            informationalWiki: true,
            knowledge: true,
            integratedAnswering: true,
            kinds: [
                "troubleshootingGuide",
                "projectBrief",
                "timeline",
                "wiki",
                "schemaView",
            ],
        });
    });
    async function fixture(): Promise<ViewSaveRequest> {
        const corpus = await service.createCorpus("Draft views");
        const result = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "diagnosis",
                sourceType: "markdown",
                title: "Diagnostic evidence",
                markdown:
                    "Inspect pressure.\r\nDo not scale without correlation.",
            },
        });
        expect((await waitForMemoryJob(service, result.jobId)).state).toBe(
            "complete",
        );
        const citation = {
            sourceId: result.sourceId,
            revisionId: result.revisionId,
            locator: "chars:0-17",
            excerpt: "Inspect pressure.",
        };
        return {
            corpusId: corpus.corpusId,
            viewId: "pressure-guide",
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            expectedVersion: 0,
            definition: {
                viewId: "pressure-guide",
                kind: "troubleshootingGuide",
                selector: {
                    kind: "sources",
                    sources: [
                        {
                            sourceId: result.sourceId,
                            revisionId: result.revisionId,
                        },
                    ],
                },
            },
            content: {
                kind: "troubleshootingGuide",
                title: "Pressure diagnosis",
                sections: [
                    {
                        id: "inspect",
                        role: "diagnostic",
                        heading: "Inspect pressure",
                        body: "Inspect pressure before choosing a mitigation.",
                    },
                ],
                citations: [citation],
            },
            relationships: [
                {
                    id: "evidence-support",
                    predicate: "supportedBy",
                    to: {
                        kind: "source",
                        sourceId: result.sourceId,
                        revisionId: result.revisionId,
                    },
                    from: {
                        kind: "section",
                        viewId: "pressure-guide",
                        sectionId: "inspect",
                    },
                    citations: [citation],
                },
            ],
        };
    }

    test("layout-only reindex marks source-dependent drafts stale without changing revisions", async () => {
        const request = await fixture();
        await service.saveViewDraft(request);
        const sourceId = request.definition.selector.sources[0].sourceId;
        const before = await service.getSource(request.corpusId, sourceId);
        await service.reindexCorpus(request.corpusId);
        expect(
            (await service.getSource(request.corpusId, sourceId))!
                .activeRevisionId,
        ).toBe(before!.activeRevisionId);
        expect(
            (await service.getView({
                corpusId: request.corpusId,
                viewId: request.viewId,
            }))!.state,
        ).toBe("stale");
    });

    test("source Used by is current-only metadata, paginated and validates requests", async () => {
        const request = await fixture();
        await service.saveViewDraft(request);
        const sourceId = request.definition.selector.sources[0].sourceId;
        const secondId = "second-guide";
        await service.saveViewDraft({
            ...request,
            viewId: secondId,
            expectedHead: (await service.listViews(request.corpusId)).head,
            definition: { ...request.definition, viewId: secondId },
            relationships: [],
        });
        const usage = { corpusId: request.corpusId, sourceId, pageSize: 1 };
        const first = await service.getSourceViewUsage(usage);
        expect(first).toMatchObject({
            total: 2,
            nextContinuationToken: "1",
            items: [
                {
                    viewId: request.viewId,
                    title: request.content.title,
                    kind: "troubleshootingGuide",
                },
            ],
        });
        expect(first.items[0]).not.toHaveProperty("content");
        const last = await service.getSourceViewUsage({
            ...usage,
            continuationToken: first.nextContinuationToken!,
        });
        expect(last.items.map((item) => item.viewId)).toEqual([secondId]);
        expect(last.nextContinuationToken).toBeUndefined();
        await expect(
            service.getSourceViewUsage({ ...usage, pageSize: 0 }),
        ).rejects.toThrow("pageSize");
        await expect(
            service.getSourceViewUsage({
                ...usage,
                continuationToken: "99999999999999999999999",
            }),
        ).rejects.toThrow("continuation token");
        await expect(
            service.getSourceViewUsage({ ...usage, continuationToken: "3" }),
        ).rejects.toThrow("out of range");
        await expect(
            service.getSourceViewUsage({ ...usage, sourceId: "missing" }),
        ).rejects.toThrow("does not exist");
    });

    test("expected head/version and concurrent writers never silently overwrite", async () => {
        const request = await fixture();
        const result = await Promise.allSettled([
            service.saveViewDraft(request),
            service.saveViewDraft(request),
        ]);
        expect(
            result.filter((item) => item.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            result.filter((item) => item.status === "rejected"),
        ).toHaveLength(1);
        const snapshot = await service.listViews(request.corpusId);
        await expect(
            service.saveViewDraft({
                ...request,
                expectedHead: snapshot.head,
                expectedVersion: 99,
            }),
        ).rejects.toThrow("version conflict");
        expect(
            await service.getViewHistory({
                corpusId: request.corpusId,
                viewId: request.viewId,
            }),
        ).toHaveLength(1);
    });

    test("changing a selector creates an exact new definition revision without rewriting prior history", async () => {
        const request = await fixture();
        const first = await service.saveViewDraft(request);
        const edit = structuredClone(request);
        edit.expectedHead = first.commitId;
        edit.expectedVersion = 1;
        edit.definition.selector.sources = [];
        edit.content.citations = [];
        edit.relationships = [];
        const second = await service.saveViewDraft(edit);
        expect(second.version.definition.revisionId).not.toBe(
            first.version.definition.revisionId,
        );
        expect(second.version.relationships).toEqual([
            expect.objectContaining({
                predicate: "generatedFrom",
                to: {
                    kind: "definition",
                    viewId: request.viewId,
                    revisionId: second.version.definition.revisionId,
                },
            }),
        ]);
        expect(
            await service.getView({
                corpusId: request.corpusId,
                viewId: request.viewId,
                revisionId: first.version.revisionId,
            }),
        ).toEqual(first.version);
    });

    test("unsupported kinds, spoofed actor, invalid citations and endpoints fail before storage", async () => {
        const request = await fixture();
        const spoofed = { ...request, actor: "spoof" };
        await expect(service.saveViewDraft(spoofed)).rejects.toThrow("actor");
        const spoofedDefinition = structuredClone(request);
        Object.defineProperty(spoofedDefinition.definition, "revisionId", {
            value: "forged",
            enumerable: true,
        });
        await expect(service.saveViewDraft(spoofedDefinition)).rejects.toThrow(
            "Unsupported view definition",
        );
        const spoofedReview = structuredClone(request);
        Object.defineProperty(spoofedReview.relationships[0], "reviewState", {
            value: "reviewed",
            enumerable: true,
        });
        await expect(service.saveViewDraft(spoofedReview)).rejects.toThrow(
            "Unsupported authored relationship",
        );
        const unsupported = structuredClone(request);
        Object.defineProperty(unsupported.content, "kind", { value: "wiki" });
        await expect(service.saveViewDraft(unsupported)).rejects.toThrow(
            "Unsupported view kind",
        );
        const badCitation = structuredClone(request);
        badCitation.content.citations[0].excerpt = "Fabricated";
        await expect(service.saveViewDraft(badCitation)).rejects.toThrow(
            "exact retained",
        );
        const badEndpoint = structuredClone(request);
        badEndpoint.relationships[0].from = {
            kind: "section",
            viewId: request.viewId,
            sectionId: "missing",
        };
        await expect(service.saveViewDraft(badEndpoint)).rejects.toThrow(
            "endpoint",
        );
        expect((await service.listViews(request.corpusId)).views).toEqual([]);
        await service.close();
        service = open(false);
        expect((await service.getCapabilities()).derivedViews).toBeUndefined();
        await expect(service.listViews(request.corpusId)).rejects.toThrow(
            "explicitly disabled",
        );
    });

    test("source replacement invalidates drafts; source forget removes all affected revisions and old Git objects", async () => {
        const request = await fixture();
        const first = await service.saveViewDraft(request);
        const refRequest = {
            corpusId: request.corpusId,
            viewId: request.viewId,
        };
        const selected = request.definition.selector.sources[0];
        const result = await service.replaceSource({
            corpusId: request.corpusId,
            sourceId: selected.sourceId,
            expectedActiveRevisionId: selected.revisionId,
            source: {
                sourceType: "markdown",
                title: "New evidence",
                markdown: "New observation.",
            },
        });
        expect((await waitForMemoryJob(service, result.jobId)).state).toBe(
            "complete",
        );
        expect((await service.getView(refRequest))?.state).toBe("stale");
        await expect(
            service.saveViewDraft({
                ...request,
                expectedHead: (await service.listViews(request.corpusId)).head,
                expectedVersion: 2,
            }),
        ).rejects.toThrow("stale");
        const directory = path.join(
            root,
            request.corpusId,
            "views",
            "view-history.git",
        );
        const oldObject = path.join(
            directory,
            "objects",
            first.commitId.slice(0, 2),
            first.commitId.slice(2),
        );
        expect((await readFile(oldObject)).length).toBeGreaterThan(0);
        const confirmation = await service.previewForgetSource(
            request.corpusId,
            selected.sourceId,
        );
        await service.forgetSource({
            corpusId: request.corpusId,
            sourceId: selected.sourceId,
            confirmationToken: confirmation.confirmationToken,
        });
        expect(await service.getView(refRequest)).toBeUndefined();
        expect(await service.getViewHistory(refRequest)).toEqual([]);
        await expect(readFile(oldObject)).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(
            git.readCommit({ fs, gitdir: directory, oid: first.commitId }),
        ).rejects.toThrow();
        await service.close();
        service = open();
        expect(
            await service.getView({
                ...refRequest,
                revisionId: first.version.revisionId,
            }),
        ).toBeUndefined();
    });

    test("unchanged view blobs survive another view's edit, with no Git executable/index/checkout", async () => {
        const request = await fixture();
        const previousPath = process.env.PATH;
        let first;
        try {
            process.env.PATH = "";
            first = await service.saveViewDraft(request);
        } finally {
            if (previousPath === undefined) delete process.env.PATH;
            else process.env.PATH = previousPath;
        }
        const secondRequest = structuredClone(request);
        secondRequest.viewId = "second-guide";
        secondRequest.definition.viewId = secondRequest.viewId;
        secondRequest.relationships = [];
        secondRequest.expectedHead = first.commitId;
        const second = await service.saveViewDraft(secondRequest);
        const directory = path.join(
            root,
            request.corpusId,
            "views",
            "view-history.git",
        );
        const before = await git.readTree({
            fs,
            gitdir: directory,
            oid: first.commitId,
        });
        const after = await git.readTree({
            fs,
            gitdir: directory,
            oid: second.commitId,
        });
        expect(
            after.tree.find(
                (entry) => entry.path === "view-pressure-guide.json",
            ),
        ).toEqual(
            before.tree.find(
                (entry) => entry.path === "view-pressure-guide.json",
            ),
        );
        expect(await readdir(directory)).not.toContain("index");
        expect(await readdir(directory)).not.toContain("worktrees");
        expect(await git.listRemotes({ fs, gitdir: directory })).toEqual([]);
    });

    test.each(["blob", "tree", "commit", "ref"] as ViewHistoryFaultPoint[])(
        "failed %s preparation never changes current/history; restart ignores unreachable objects",
        async (point) => {
            const directory = path.join(root, "fault-history");
            const clean = new ViewHistory<{ value: string }>(directory, () => ({
                value: "",
            }));
            const initial = await clean.commit(
                null,
                { value: "Original" },
                {},
                "owner",
                "Initial",
            );
            const faulty = new ViewHistory<{ value: string }>(
                directory,
                () => ({ value: "" }),
                async (stage) => {
                    if (stage === point)
                        throw new Error(`Injected ${point} failure`);
                },
            );
            await expect(
                faulty.commit(
                    initial,
                    { value: "Uncommitted" },
                    {},
                    "owner",
                    "Should fail",
                ),
            ).rejects.toThrow("Injected");
            const restarted = new ViewHistory<{ value: string }>(
                directory,
                () => ({ value: "" }),
            );
            expect(await restarted.read()).toEqual({
                head: initial,
                state: { value: "Original" },
                stateBytes: Buffer.byteLength(
                    JSON.stringify({ value: "Original" }),
                ),
            });
            expect(await restarted.history()).toHaveLength(1);
        },
    );

    test("an absent history has zero committed bytes, including an undefined empty state", async () => {
        const history = new ViewHistory<undefined>(
            path.join(root, "empty-history"),
            () => undefined,
        );
        expect(await history.read()).toEqual({
            head: null,
            state: undefined,
            stateBytes: 0,
        });
    });

    test.each(["purge-prepared", "purge-swapped"] as ViewHistoryFaultPoint[])(
        "interrupted %s stays quarantined until restart completes full object database removal",
        async (point) => {
            const directory = path.join(root, "purge-fault-history");
            const clean = new ViewHistory<{ value: string }>(directory, () => ({
                value: "",
            }));
            const initial = await clean.commit(
                null,
                { value: "Forget this" },
                {},
                "owner",
                "Initial",
            );
            const faulty = new ViewHistory<{ value: string }>(
                directory,
                () => ({ value: "" }),
                async (stage) => {
                    if (stage === point)
                        throw new Error(`Interrupted ${point}`);
                },
            );
            const sanitize = () => ({ value: "Retained" });
            await expect(
                faulty.purge("forgotten-source", sanitize, () => ({})),
            ).rejects.toThrow("Interrupted");
            await expect(clean.read()).rejects.toThrow("quarantined");
            await clean.recoverPurge(sanitize, () => ({}));
            expect((await clean.read()).state.value).toBe("Retained");
            await expect(clean.read(initial)).rejects.toThrow();
            expect(await readdir(directory)).toEqual(["view-history.git"]);
        },
    );

    test("bare adapter expected-head lock, unreachable preparations, and quarantine recovery", async () => {
        const directory = path.join(root, "isolated-history");
        const history = new ViewHistory<{ text: string }>(directory, () => ({
            text: "",
        }));
        const initial = await history.commit(
            null,
            { text: "Private source text" },
            {},
            "owner",
            "Initial",
        );
        await expect(
            history.commit(null, { text: "Wrong" }, {}, "owner", "Conflict"),
        ).rejects.toThrow("head conflict");
        expect((await history.read()).head).toBe(initial);
        const sanitize = () => ({ text: "Sanitized" });
        await history.purge("source", sanitize, () => ({}));
        expect((await history.read()).state.text).toBe("Sanitized");
        await history.recoverPurge(sanitize, () => ({}));
        await expect(history.read(initial)).rejects.toThrow();
    });

    test("CLI enables Views without an opt-in flag", async () => {
        await service.close();
        const corpus = await runMemoryViewsCli([
            "--store",
            root,
            "create-corpus",
            "CLI views",
        ]);
        expect(corpus).toMatchObject({ name: "CLI views" });
        await expect(
            runMemoryViewsCli(["--store", root, "list"]),
        ).rejects.toThrow("Derived Views");
        const corpora = await runMemoryViewsCli(["--store", root, "corpora"]);
        expect(corpora).toEqual([corpus]);
    });

    test("CLI publication settings persist, report absent indexes, and reject stale or missing publication targets", async () => {
        const corpus = await service.createCorpus("Publication CLI");
        const snapshot = await service.listViews(corpus.corpusId);
        await service.close();
        const args = ["--store", root];
        expect(
            await runMemoryViewsCli([...args, "policy", corpus.corpusId]),
        ).toMatchObject({
            revision: 0,
            autoPublish: true,
        });
        const file = path.join(root, "publication-cli-request.json");
        await writeFile(
            file,
            JSON.stringify({
                corpusId: corpus.corpusId,
                expectedHead: snapshot.head,
                expectedRevision: 0,
                autoPublish: false,
            }),
        );
        expect(
            await runMemoryViewsCli([...args, "set-policy", file]),
        ).toMatchObject({
            revision: 1,
            autoPublish: false,
        });
        await expect(
            runMemoryViewsCli([...args, "set-policy", file]),
        ).rejects.toThrow("history head conflict");
        expect(
            await runMemoryViewsCli([
                ...args,
                "publication",
                corpus.corpusId,
                "missing-guide",
            ]),
        ).toMatchObject({ indexState: "absent" });
        expect(
            await runMemoryViewsCli([
                ...args,
                "search",
                corpus.corpusId,
                "pressure",
            ]),
        ).toEqual([]);
        const current = await runMemoryViewsCli([
            ...args,
            "list",
            corpus.corpusId,
        ]);
        if (!current || typeof current !== "object" || !("head" in current))
            throw new Error("CLI list did not return the concurrency head");
        await writeFile(
            file,
            JSON.stringify({
                corpusId: corpus.corpusId,
                viewId: "missing-guide",
                revisionId: "missing-revision",
                expectedHead: current.head,
                expectedVersion: 1,
            }),
        );
        await expect(
            runMemoryViewsCli([...args, "publish", file]),
        ).rejects.toThrow("Publication revision is missing");
        await expect(
            runMemoryViewsCli([...args, "retry-index", file]),
        ).rejects.toThrow(
            "Index retry head, target or published revision conflict",
        );
    });

    test.each<[string, string[]]>([
        ["corpora", ["extra"]],
        ["create-corpus", []],
        ["create-corpus", ["name", "extra"]],
        ["list", []],
        ["list", ["corpus", "extra"]],
        ["sources", []],
        ["sources", ["corpus", "extra"]],
        ["source", ["corpus"]],
        ["source", ["corpus", "source", "revision", "extra"]],
        ["read", ["corpus"]],
        ["read", ["corpus", "view", "revision", "extra"]],
        ["history", ["corpus"]],
        ["history", ["corpus", "view", "extra"]],
        ["save", []],
        ["save", ["request.json", "extra"]],
        ["archive", []],
        ["archive", ["request.json", "extra"]],
        ["publish", []],
        ["publish", ["corpus", "view", "extra"]],
        ["toString", []],
        ["unknown", []],
    ])("CLI rejects invalid %s arguments", async (command, values) => {
        await expect(
            runMemoryViewsCli(["--store", root, command, ...values]),
        ).rejects.toThrow("Derived Views");
    });

    test("compiled CLI entrypoint runs with no Git executable on PATH", async () => {
        await service.close();
        const script = fileURLToPath(
            new URL("../memoryViewsCli.js", import.meta.url),
        );
        const { stdout } = await promisify(execFile)(
            process.execPath,
            [script, "--store", root, "create-corpus", "Executable CLI views"],
            { env: { ...process.env, PATH: "" } },
        );
        expect(JSON.parse(stdout)).toMatchObject({
            name: "Executable CLI views",
        });
    });

    test("CLI save/read/history/archive are runnable across separate service lifetimes", async () => {
        const corpus = await service.createCorpus("CLI authoring");
        const initialHead = (await service.listViews(corpus.corpusId)).head;
        await service.close();
        const request: ViewSaveRequest = {
            corpusId: corpus.corpusId,
            viewId: "manual-guide",
            expectedVersion: 0,
            expectedHead: initialHead,
            definition: {
                viewId: "manual-guide",
                kind: "troubleshootingGuide",
                selector: { kind: "sources", sources: [] },
            },
            content: {
                kind: "troubleshootingGuide",
                title: "Manual diagnostic guide",
                sections: [
                    {
                        id: "inspect",
                        role: "diagnostic",
                        heading: "Inspect",
                        body: "Correlate before changing capacity.",
                    },
                ],
                citations: [],
            },
            relationships: [],
        };
        const file = path.join(root, "cli-request.json");
        const args = ["--store", root];
        await writeFile(file, JSON.stringify(request));
        const saved = await runMemoryViewsCli([...args, "save", file]);
        expect(saved).toMatchObject({
            version: { version: 1, state: "draft" },
        });
        expect(
            await runMemoryViewsCli([
                ...args,
                "read",
                corpus.corpusId,
                request.viewId,
            ]),
        ).toMatchObject({ version: 1, content: request.content });
        expect(
            await runMemoryViewsCli([
                ...args,
                "history",
                corpus.corpusId,
                request.viewId,
            ]),
        ).toEqual([saved]);
        service = open();
        const snapshot = await service.listViews(corpus.corpusId);
        await service.close();
        await writeFile(
            file,
            JSON.stringify({
                corpusId: corpus.corpusId,
                viewId: request.viewId,
                expectedVersion: 1,
                expectedHead: snapshot.head,
            }),
        );
        expect(
            await runMemoryViewsCli([...args, "archive", file]),
        ).toMatchObject({ version: { version: 2, state: "archived" } });
        await expect(
            runMemoryViewsCli([
                ...args,
                "publish",
                corpus.corpusId,
                request.viewId,
            ]),
        ).rejects.toThrow("Derived Views");
    });
});
