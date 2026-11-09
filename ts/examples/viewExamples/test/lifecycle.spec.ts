// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    cp,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { FileMemoryService } from "@typeagent/memory-service";
import {
    buildProcedure,
    completedIngestion,
    hostOptions,
    packageRoot,
    procedureDefinition,
    runExample,
    settleBuild,
} from "../src/host.js";
import {
    createProcedureProvider,
    procedureProviderId,
} from "../src/procedural/provider.js";

let root: string;
let service: FileMemoryService | undefined;
let allowed: boolean;
let sourceAllowed: boolean;
let content: string;
beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "typeagent-procedure-"));
    allowed = true;
    sourceAllowed = true;
    content = await readFile(
        path.join(packageRoot, "fixtures", "connectivity.jsonl"),
        "utf8",
    );
});
afterEach(async () => {
    await service?.close();
    service = undefined;
    await rm(root, { recursive: true, force: true });
});

async function setup() {
    service = new FileMemoryService(path.join(root, "memory"), hostOptions([]));
    const corpus = await service.createCorpus("Original offline fixture");
    await service.close();
    const provider = await createProcedureProvider({
        corpusId: corpus.corpusId,
        sourceIds: ["source"],
        authorize: async () => allowed,
    });
    service = new FileMemoryService(path.join(root, "memory"), {
        ...hostOptions([provider]),
        sourceAuthorization: async () => sourceAllowed,
    });
    const ingestion = await service.ingestDocument({
        corpusId: corpus.corpusId,
        source: {
            sourceId: "source",
            sourceType: "text",
            title: "Fictional connectivity",
            text: content,
        },
        pipeline: { mode: "content" },
    });
    await completedIngestion(service, ingestion.jobId);
    const source = await service.getSource(corpus.corpusId, "source");
    if (!source?.activeRevisionId)
        throw new Error("Fixture source is not ready");
    const definition = procedureDefinition(provider, "mock-connectivity", [
        { sourceId: "source", revisionId: source.activeRevisionId },
    ]);
    return { corpusId: corpus.corpusId, provider, source, definition };
}
async function publish(
    corpusId: string,
    view: Awaited<ReturnType<typeof buildProcedure>>["view"],
) {
    const head = (await service!.listViews(corpusId)).head!;
    await service!.publishView({
        corpusId,
        viewId: view.viewId,
        revisionId: view.revisionId,
        expectedVersion: view.version,
        expectedHead: head,
    });
}

test.each([false, true])(
    "runner persists, renders and restarts; explicit publication=%s",
    async (publish) => {
        const result = await runExample({
            outputDirectory: path.join(root, "run"),
            publish,
        });
        const receipt = JSON.parse(
            await readFile(
                path.join(result.outputDirectory, "result.json"),
                "utf8",
            ),
        );
        expect(receipt.restartVerified).toBe(true);
        expect(receipt.mode).toBe("offline-lexical-knowpro");
        expect(receipt.searchMatches).toBe(publish ? 1 : 0);
        expect(receipt.publication.indexState).toBe(
            publish ? "ready" : "absent",
        );
    },
);

test("source replacement withdraws published derived search; forget does not expose a draft fallback", async () => {
    const { corpusId, definition, source } = await setup();
    const { view } = await buildProcedure(service!, corpusId, definition);
    await publish(corpusId, view);
    const query = {
        corpusId,
        query: "indicator",
        freshness: "current" as const,
    };
    expect(await service!.searchViews(query)).toHaveLength(1);
    const replacement = await service!.replaceSource({
        corpusId,
        sourceId: source.sourceId,
        expectedActiveRevisionId: source.activeRevisionId!,
        source: {
            sourceType: "text",
            title: "Changed procedure",
            text: content.replace("green indicator", "blue indicator"),
        },
    });
    await completedIngestion(service!, replacement.jobId);
    expect(await service!.searchViews(query)).toEqual([]);
    const preview = await service!.previewForgetSource(
        corpusId,
        source.sourceId,
    );
    await service!.forgetSource({
        corpusId,
        sourceId: source.sourceId,
        confirmationToken: preview.confirmationToken,
    });
    expect(await service!.searchViews(query)).toEqual([]);
});

test.each(["source", "provider"])(
    "revoked %s authorization prevents cold read and published search",
    async (scope) => {
        const { corpusId, definition, provider } = await setup();
        const { view } = await buildProcedure(service!, corpusId, definition);
        await publish(corpusId, view);
        if (scope === "source") sourceAllowed = false;
        else allowed = false;
        await service!.close();
        service = new FileMemoryService(path.join(root, "memory"), {
            ...hostOptions([provider]),
            sourceAuthorization: async () => sourceAllowed,
        });
        const read = service.getView({
            corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
        });
        await expect(read).resolves.toBeUndefined();
        const search = service.searchViews({
            corpusId,
            query: "indicator",
            freshness: "current",
        });
        if (scope === "source") {
            await expect(search).resolves.toEqual([]);
        } else {
            await expect(search).rejects.toThrow(
                "Provider scope is not authorized",
            );
        }
    },
);

test("stale optimistic publication/build guards fail instead of overwriting", async () => {
    const { corpusId, definition } = await setup();
    const { view } = await buildProcedure(service!, corpusId, definition);
    await expect(
        service!.publishView({
            corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            expectedVersion: 0,
            expectedHead: (await service!.listViews(corpusId)).head!,
        }),
    ).rejects.toThrow();
    await expect(
        service!.buildViews({
            corpusId,
            expectedHead: "not-the-current-head",
            targets: [{ definition, expectedVersion: 0 }],
            publication: false,
        }),
    ).rejects.toThrow();
});

test("cancellation cannot commit a delayed provider candidate", async () => {
    const { corpusId, definition, provider } = await setup();
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    const pause = new Promise<void>((resolve) => {
        release = resolve;
    });
    const original = provider.generate;
    provider.generate = async (...args) => {
        started();
        await pause;
        return original(...args);
    };
    const job = await service!.buildViews({
        corpusId,
        expectedHead: (await service!.listViews(corpusId)).head,
        targets: [{ definition, expectedVersion: 0 }],
        publication: false,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            entered,
            new Promise<never>(
                (_, reject) =>
                    (timer = setTimeout(
                        () => reject(new Error("Provider did not start")),
                        10000,
                    )),
            ),
        ]);
        const cancelling = service!.cancelViewBuild({
            corpusId,
            jobId: job.jobId,
        });
        release();
        const result = await settleBuild(service!, await cancelling);
        expect(result.state).toBe("cancelled");
        expect(
            await service!.getView({ corpusId, viewId: definition.viewId }),
        ).toBeUndefined();
    } finally {
        clearTimeout(timer);
        release();
    }
});

test("pack relocates without checkout paths; changed assets require update and restart", async () => {
    const relocated = path.join(root, "relocated");
    await mkdir(path.join(relocated, "dist"), { recursive: true });
    await cp(
        path.join(packageRoot, "dist", "procedural"),
        path.join(relocated, "dist", "procedural"),
        { recursive: true },
    );
    await cp(
        path.join(packageRoot, "manifest.json"),
        path.join(relocated, "manifest.json"),
    );
    const packageJson = JSON.parse(
        await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );
    await writeFile(
        path.join(relocated, "package.json"),
        JSON.stringify(packageJson),
    );
    // Installed dependencies are host supplied, not an absolute provider import.
    await mkdir(path.join(relocated, "node_modules", "@typeagent"), {
        recursive: true,
    });
    await symlink(
        await realpath(
            path.join(
                packageRoot,
                "node_modules",
                "@typeagent",
                "memory-service",
            ),
        ),
        path.join(relocated, "node_modules", "@typeagent", "memory-service"),
        process.platform === "win32" ? "junction" : "dir",
    );
    const script = `
        import assert from "node:assert/strict";
        import { readFile, writeFile } from "node:fs/promises";
        import path from "node:path";
        const { inspectMemoryViewPackage, loadMemoryViewPackage } = await import(process.argv[2]);
        const root = process.argv[1];
        const installation = await inspectMemoryViewPackage(root);
        const selection = [{ providerId: "${procedureProviderId}", context: {
            corpusId: "fixture", sourceIds: ["source"], authorize: async () => true
        }}];
        const loaded = await loadMemoryViewPackage(installation, selection);
        assert.equal(loaded[0].descriptor.identity.providerId, "${procedureProviderId}");
        const prose = await loadMemoryViewPackage(installation, [{ providerId: "typeagent-support-procedure-prose", context: {
            corpusId: "fixture", sourceIds: ["source"], authorize: async () => true,
            approvedModelWork: true, modelIdentity: "a".repeat(64),
            model: { completionSettings: {}, complete: async () => { throw new Error("No relocation inference"); } }
        }}]);
        assert.equal(prose[0].descriptor.identity.providerId, "typeagent-support-procedure-prose");
        const recipe = path.join(root, "dist", "procedural", "recipe.txt");
        await writeFile(recipe, (await readFile(recipe, "utf8")) + "\\nChanged recipe");
        await assert.rejects(loadMemoryViewPackage(installation, selection), /update explicitly/);
        const updated = await inspectMemoryViewPackage(root);
        assert.notEqual(updated.fingerprint, installation.fingerprint);
        await assert.rejects(loadMemoryViewPackage(updated, selection), /host restart/);
        console.log("relocation/update/restart verified");
    `;
    const result = await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "--eval",
        script,
        relocated,
        pathToFileURL(
            createRequire(import.meta.url).resolve("@typeagent/memory-service"),
        ).href,
    ]);
    expect(result.stdout).toContain("relocation/update/restart verified");
});
