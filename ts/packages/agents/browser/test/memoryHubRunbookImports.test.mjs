// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryBatchStore } from "@typeagent/memory-service";
import { resolvePublicIpAddress } from "@typeagent/common-utils/network";
import {
    acquireSelectedRunbooks,
    selectedRelativePath,
} from "../dist/agent/runbookImportFiles.mjs";
import { acquireRunbookUrl } from "../dist/agent/runbookImportRemote.mjs";
import {
    assertRunbookGatewaySize,
    createMemoryHubRunbookImportFunctions,
    runbookImportBatchId,
} from "../dist/agent/memoryHubRunbookImports.mjs";
import {
    runbookImportRequestSchema,
    runbookImportViewSchemas,
} from "../dist/views/server/features/views/runbookImportSchemas.mjs";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function selected(relativePath, content, extra = {}) {
    return {
        relativePath,
        contentBase64: Buffer.from(content).toString("base64"),
        ...extra,
    };
}
function request(files, extra = {}) {
    return {
        corpusId: "alpha",
        idempotencyKey: "stable-key",
        kind: "folder",
        files,
        ...extra,
    };
}
function batch(corpusId = "alpha", state = "running") {
    return {
        batchId: "a".repeat(64),
        corpusId,
        state,
        createdAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
        members: [
            {
                memberId: "0",
                contentIdentity: "content",
                state: "pending",
                warnings: [],
            },
        ],
    };
}
function service(overrides = {}) {
    const started = [];
    const actions = [];
    const stored = new Map();
    return {
        started,
        actions,
        getCorpus: async (corpusId) => ({ corpusId, name: corpusId }),
        startBatchImport: async (value) => {
            started.push(value);
            const result = {
                ...batch(value.corpusId),
                batchId: runbookImportBatchId(value),
                acquisitionFingerprint: value.acquisitionFingerprint,
                state: value.documents.length ? "running" : "failed",
                acquisitionIssues: value.acquisitionIssues,
                warnings: value.warnings,
                members: [
                    ...value.documents.map((document, index) => ({
                        ...batch().members[0],
                        memberId: String(index),
                        clientKey: value.documentKeys?.[index],
                        displayName: document.source.title,
                        stage: "ingestion",
                        warnings: [],
                    })),
                    ...(value.rejectedMembers ?? []).map((rejected, index) => ({
                        memberId: String(value.documents.length + index),
                        contentIdentity: "",
                        clientKey: rejected.memberKey,
                        displayName: rejected.displayName,
                        stage: "acquisition",
                        state: "failed",
                        reason: `Acquisition rejected: ${rejected.reason}`,
                        warnings: [],
                    })),
                ],
            };
            stored.set(result.batchId, result);
            return result;
        },
        getBatchImport: async (batchId) => {
            if (stored.has(batchId)) return stored.get(batchId);
            throw Object.assign(new Error("Missing batch"), { code: "ENOENT" });
        },
        findBatchImport: async (request) =>
            stored.get(runbookImportBatchId(request)),
        listBatchImports: async (corpusId) => [batch(corpusId)],
        retryBatchImport: async (batchId) => {
            actions.push(["retry", batchId]);
            return batch();
        },
        cancelBatchImport: async (batchId) => {
            actions.push(["cancel", batchId]);
            return batch("alpha", "cancelled");
        },
        listRunbookJobs: async () => [],
        ...overrides,
    };
}
function remote(responses) {
    const calls = [];
    let index = 0;
    return {
        calls,
        resolve: async (hostname) =>
            resolvePublicIpAddress(hostname, async () => [
                { address: "8.8.8.8", family: 4 },
            ]),
        request(url, options, callback) {
            calls.push({ url: url.href, options });
            const operation = new EventEmitter();
            operation.end = () => {
                const entry = responses[index++];
                const response = Readable.from([Buffer.from(entry.body ?? "")]);
                response.statusCode = entry.status ?? 200;
                response.headers = entry.headers ?? {
                    "content-type": "text/plain; charset=utf-8",
                };
                queueMicrotask(() => callback(response));
            };
            return operation;
        },
    };
}

test("selected files preserve whole originals and attach only same-tree user-selected local image bytes", () => {
    const text =
        "# Restart\n\n1. Inspect.\n\n![screen](../images/screen.png)\n";
    const acquired = acquireSelectedRunbooks("folder", [
        selected("export/docs/restart.md", text),
        selected("export/images/screen.png", png, {
            description: "Manual dashboard description",
        }),
    ]);
    assert.equal(acquired.documents.length, 1);
    const source = acquired.documents[0].source;
    assert.equal(source.markdown, text);
    assert.equal(source.title, "Restart");
    assert.equal(source.sourceType, "markdown");
    assert.equal(
        source.canonicalUri,
        "urn:typeagent:runbook-import:folder:export%2Fdocs%2Frestart.md",
    );
    assert.deepEqual(Buffer.from(source.assets[0].bytes), png);
    assert.equal(source.assets[0].description, "Manual dashboard description");
    assert.equal(
        source.metadata.runbookImport.imageReferences[0].reference,
        "../images/screen.png",
    );
    assert.deepEqual(acquired.issues, []);
});

test("identical exported originals and images retain stable asset identities across selected root names", () => {
    const original = "# Guide\n\n![screen](images/screen.png)";
    const acquisition = acquireSelectedRunbooks("folder", [
        selected("first/guide.md", original),
        selected("first/images/screen.png", png),
        selected("second/guide.md", original),
        selected("second/images/screen.png", png),
    ]);
    assert.equal(acquisition.documents.length, 2);
    assert.equal(
        acquisition.documents[0].source.assets[0].name,
        acquisition.documents[1].source.assets[0].name,
    );
    assert.equal(acquisition.documents[0].source.markdown, original);
    assert.equal(acquisition.documents[1].source.markdown, original);
});

test("HTML originals and reference-style Markdown images remain intact; invalid images require explicit review", () => {
    const html =
        '<html><title>Install guide</title><img src="image.png"><script>danger()</script></html>';
    const acquired = acquireSelectedRunbooks("wiki", [
        selected("wiki/page.html", html),
        selected(
            "wiki/reference.md",
            "![Dashboard][screen]\n\n[screen]: image.png\n",
        ),
        selected("wiki/image.png", png),
        selected("wiki/invalid.md", "![Invalid](invalid.png)"),
        selected("wiki/invalid.png", "not an image"),
    ]);
    assert.equal(acquired.documents[0].source.html, html);
    assert.equal(acquired.documents[0].source.title, "Install guide");
    assert.equal(acquired.documents[1].source.assets.length, 1);
    assert.equal(acquired.documents[2].source.assets.length, 0);
    assert(acquired.issues.some((issue) => issue.reason.includes("MIME")));
});

test("unsupported members, missing/remote/traversing references and unreferenced images are explicit, not fake success", () => {
    const acquired = acquireSelectedRunbooks("folder", [
        selected(
            "root/guide.md",
            "# Guide\n![remote](https://example.org/image.png)\n![escape](../../outside.png)\n![missing](missing.png)",
        ),
        selected("root/archive.zip", "archive bytes"),
        selected("root/orphan.png", png),
    ]);
    assert.equal(acquired.documents.length, 1);
    assert.equal(acquired.documents[0].source.assets.length, 0);
    assert(
        acquired.issues.some(
            (issue) =>
                issue.member === "root/archive.zip" &&
                issue.state === "rejected",
        ),
    );
    assert(
        acquired.issues.some((issue) => issue.reason.includes("not fetched")),
    );
    assert(acquired.issues.some((issue) => issue.reason.includes("escapes")));
    assert(acquired.issues.some((issue) => issue.reason.includes("not among")));
    assert(acquired.issues.some((issue) => issue.member === "root/orphan.png"));
});

test("gateway and selected-tree paths reject arbitrary host paths, traversal and symlink-shaped payloads", () => {
    for (const name of [
        "../outside.md",
        "/host/file.md",
        "C:\\host\\file.md",
        "root/../file.md",
        "root//file.md",
    ])
        assert.throws(() => selectedRelativePath(name), /relative/);
    assert.throws(
        () =>
            acquireSelectedRunbooks("wiki", [
                selected("same.md", "a"),
                selected("same.md", "b"),
            ]),
        /Duplicate/,
    );
    assert.throws(() =>
        runbookImportRequestSchema.parse(
            request([selected("file.md", "text", { symlink: true })]),
        ),
    );
    assert.throws(() =>
        runbookImportRequestSchema.parse({
            ...request([]),
            hostPath: "C:\\secret",
        }),
    );
    const invalid = acquireSelectedRunbooks("wiki", [
        selected("bad.md", "text", { contentBase64: "%%%not-base64" }),
    ]);
    assert.equal(invalid.documents.length, 0);
    assert.match(invalid.issues[0].reason, /base64/);
});

test("each remote hop resolves only public IPs, pins DNS lookup, and forwards no cookies or credentials", async () => {
    const dependencies = remote([
        {
            status: 302,
            headers: {
                location: "https://public.example/guide",
                "content-type": "text/plain",
            },
        },
        {
            body: "# Install\n\n1. Read.",
            headers: { "content-type": "text/markdown" },
        },
    ]);
    const acquired = await acquireRunbookUrl(
        "https://public.example/start#fragment",
        dependencies,
    );
    assert.equal(acquired.url, "https://public.example/guide");
    assert.equal(acquired.text, "# Install\n\n1. Read.");
    assert.equal(acquired.mimeType, "text/markdown");
    assert.equal(dependencies.calls.length, 2);
    for (const call of dependencies.calls) {
        assert.equal(call.options.headers.cookie, undefined);
        assert.equal(call.options.headers.authorization, undefined);
        assert.equal(call.options.headers["accept-encoding"], "identity");
        call.options.lookup("ignored", {}, (error, address, family) => {
            assert.equal(error, null);
            assert.equal(address, "8.8.8.8");
            assert.equal(family, 4);
        });
    }
});

test("private targets, unsafe redirects, mixed public/private DNS and authentication URLs never reach a request", async () => {
    for (const url of [
        "http://127.0.0.1/guide",
        "http://[::1]/guide",
        "https://localhost/guide",
        "file:///secret",
        "https://user:password@public.example/",
        "https://public.example/guide?access_token=placeholder",
        "https://public.example/guide?sig=placeholder",
        "http://public.example:8080/",
    ]) {
        const dependencies = remote([]);
        await assert.rejects(acquireRunbookUrl(url, dependencies));
        assert.equal(dependencies.calls.length, 0);
    }
    const redirected = remote([
        {
            status: 302,
            headers: { location: "http://169.254.169.254/credentials" },
        },
    ]);
    await assert.rejects(
        acquireRunbookUrl("https://public.example", redirected),
        /Private network/,
    );
    assert.equal(redirected.calls.length, 1);
    const mixed = remote([]);
    mixed.resolve = (hostname) =>
        resolvePublicIpAddress(hostname, async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "10.0.0.1", family: 4 },
        ]);
    await assert.rejects(
        acquireRunbookUrl("https://mixed.example", mixed),
        /Private network/,
    );
    assert.equal(mixed.calls.length, 0);
});

test("remote format/charset/body limits reject explicitly without truncating originals", async () => {
    for (const entry of [
        { headers: { "content-type": "application/zip" }, body: "zip" },
        {
            headers: { "content-type": "text/plain; charset=latin1" },
            body: "text",
        },
        {
            headers: {
                "content-type": "text/plain",
                "content-encoding": "gzip",
            },
            body: "compressed",
        },
        { body: "x".repeat(2 * 1024 * 1024 + 1) },
        {
            headers: {
                "content-type": "text/plain",
                "content-length": String(3 * 1024 * 1024),
            },
        },
        { status: 401, body: "authenticate" },
    ])
        await assert.rejects(
            acquireRunbookUrl("https://public.example", remote([entry])),
        );
});

test("partial acquisition persists rejects; all unsupported creates a durable rejection-only batch", async () => {
    const fixture = service();
    const functions = createMemoryHubRunbookImportFunctions(
        () => fixture,
        async (url) => {
            if (url.includes("bad")) throw new Error("HTTP 404");
            return {
                url,
                text: "# Guide\n\n1. Read.",
                mimeType: "text/markdown",
            };
        },
    );
    const result = await functions.memoryHubStartRunbookImport({
        corpusId: "alpha",
        idempotencyKey: "urls",
        kind: "urls",
        urls: ["https://public.example/guide", "https://public.example/bad"],
    });
    assert.equal(result.batch.corpusId, "alpha");
    assert.equal(fixture.started[0].documents.length, 1);
    assert.equal(
        fixture.started[0].documents[0].source.markdown,
        "# Guide\n\n1. Read.",
    );
    assert(
        result.acquisition.some(
            (issue) =>
                issue.state === "rejected" && issue.reason === "HTTP 404",
        ),
    );
    const unsupported = await functions.memoryHubStartRunbookImport(
        request([selected("archive.zip", "zip")]),
    );
    assert.equal(unsupported.batch.state, "failed");
    assert.equal(unsupported.batch.members[0].stage, "acquisition");
    assert.equal(unsupported.acquisition[0].state, "rejected");
    assert.equal(fixture.started.length, 2);
});

test("rejection details and display labels obey core bounds with explicit abbreviation, retaining opaque identity", async () => {
    const fixture = service();
    const functions = createMemoryHubRunbookImportFunctions(
        () => fixture,
        async () => {
            throw new Error("failure ".repeat(600));
        },
    );
    const input = {
        corpusId: "alpha",
        idempotencyKey: "long-rejection",
        kind: "urls",
        urls: [`https://public.example/${"a".repeat(250)}`],
    };
    const response = await functions.memoryHubStartRunbookImport(input);
    const rejected = fixture.started[0].rejectedMembers[0];
    assert.equal(rejected.displayName.length, 200);
    assert(rejected.displayName.endsWith("[name abbreviated]"));
    assert.equal(rejected.reason.length, 2000);
    assert(rejected.reason.endsWith("[error details abbreviated]"));
    assert.match(rejected.memberKey, /^[a-f0-9]{64}$/);
    assert.equal(response.acquisition[0].member, input.urls[0]);
});

test("canonical acquisition issues use opaque keys and bounded aggregate warnings, retained by lookup without reacquisition", async () => {
    const fixture = service();
    const input = request([
        selected(
            "export/guide.md",
            "# Guide\n" +
                Array.from(
                    { length: 32 },
                    (_, index) =>
                        `![image](missing-${index}-${"a".repeat(90)}.png)`,
                ).join("\n"),
        ),
        selected("export/unsupported.zip", "archive"),
        selected("export/orphan.png", png),
    ]);
    const functions = createMemoryHubRunbookImportFunctions(() => fixture);
    const first = await functions.memoryHubStartRunbookImport(input);
    const core = fixture.started[0];
    assert.equal(core.acquisitionIssues.length, 2);
    for (const issue of core.acquisitionIssues) {
        assert.match(issue.member, /^[a-f0-9]{64}$/);
        assert(issue.reason.length <= 2000);
    }
    const warning = core.acquisitionIssues.find(
        (issue) => issue.state === "warning",
    );
    assert.equal(warning.member, core.documentKeys[0]);
    assert(warning.reason.endsWith("[error details abbreviated]"));
    const recovered = await createMemoryHubRunbookImportFunctions(
        () => fixture,
    ).memoryHubStartRunbookImport(input);
    assert.equal(recovered.batch.batchId, first.batch.batchId);
    assert.equal(fixture.started.length, 1);
    assert.equal(recovered.acquisition.length, 2);
    assert.equal(recovered.acquisition[0].member, "export/guide.md");
    assert.equal(recovered.acquisition[1].member, "export/unsupported.zip");
    assert.equal(recovered.acquisition[0].reason, warning.reason);
    assert(recovered.warnings.some((notice) => notice.includes("orphan.png")));
});

test("unassociated notices are bounded with explicit abbreviation and never fabricate a warning-only batch member", async () => {
    const fixture = service();
    const functions = createMemoryHubRunbookImportFunctions(() => fixture);
    const images = Array.from({ length: 190 }, (_, index) =>
        selected(`export/orphan-${index}.png`, png),
    );
    await functions.memoryHubStartRunbookImport(
        request([selected("export/guide.md", "# Guide"), ...images]),
    );
    const core = fixture.started[0];
    assert.equal(core.warnings.length, 1);
    assert.equal(core.warnings[0].length, 1000);
    assert(
        core.warnings[0].startsWith("190 unassociated acquisition notice(s)"),
    );
    assert(core.warnings[0].endsWith("[notice details abbreviated]"));
    assert.equal(core.documents.length, 1);
    const imageOnly = await functions.memoryHubStartRunbookImport(
        request(images, { idempotencyKey: "image-only" }),
    );
    assert.equal(imageOnly.batch, undefined);
    assert.equal(fixture.started.length, 1);
});

test("body/core/document/asset limits are measured before core ingestion and never silently truncated", async () => {
    assert.throws(
        () =>
            assertRunbookGatewaySize(
                request([selected("large.md", "x".repeat(8 * 1024 * 1024))]),
            ),
        /10 MB/,
    );
    const fixture = service();
    const functions = createMemoryHubRunbookImportFunctions(() => fixture);
    await assert.rejects(
        functions.memoryHubStartRunbookImport(
            request(
                Array.from({ length: 51 }, (_, index) =>
                    selected(`${index}.md`, `# Guide ${index}`),
                ),
            ),
        ),
        /50/,
    );
    await assert.rejects(
        functions.memoryHubStartRunbookImport(
            request([selected("escaped.md", "\\".repeat(4.5 * 1024 * 1024))]),
        ),
        /8 MB/,
    );
    const oversized = acquireSelectedRunbooks("folder", [
        selected("root/guide.md", "![a](a.png)\n![b](b.png)"),
        selected(
            "root/a.png",
            Buffer.concat([png, Buffer.alloc(3.1 * 1024 * 1024)]),
        ),
        selected(
            "root/b.png",
            Buffer.concat([png, Buffer.alloc(3.1 * 1024 * 1024)]),
        ),
    ]);
    assert.equal(oversized.documents.length, 0);
    assert(
        oversized.issues.some((issue) =>
            issue.reason.includes("Revision assets exceed"),
        ),
    );
    assert.equal(fixture.started.length, 0);
});

test("URL acquisition stops on the aggregate core budget without truncating or committing a partial batch", async () => {
    const fixture = service();
    let calls = 0;
    const functions = createMemoryHubRunbookImportFunctions(
        () => fixture,
        async (url) => {
            calls++;
            return {
                url,
                text: "x".repeat(2 * 1024 * 1024),
                mimeType: "text/plain",
            };
        },
    );
    await assert.rejects(
        functions.memoryHubStartRunbookImport({
            corpusId: "alpha",
            idempotencyKey: "bounded-urls",
            kind: "urls",
            urls: Array.from(
                { length: 10 },
                (_, index) => `https://public.example/${index}`,
            ),
        }),
        /8 MB/,
    );
    assert(calls <= 4);
    assert.equal(fixture.started.length, 0);
});

test("duplicate starts share one acquisition; changed inputs cannot reuse a live idempotency key", async () => {
    const fixture = service();
    let finish;
    const functions = createMemoryHubRunbookImportFunctions(
        () => fixture,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const input = {
        corpusId: "alpha",
        idempotencyKey: "stable",
        kind: "urls",
        urls: ["https://public.example/guide"],
    };
    const first = functions.memoryHubStartRunbookImport(input);
    const second = functions.memoryHubStartRunbookImport(input);
    assert.equal(first, second);
    assert.throws(
        () =>
            functions.memoryHubStartRunbookImport({
                ...input,
                urls: ["https://public.example/changed"],
            }),
        /different/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    finish({ url: input.urls[0], text: "# Guide", mimeType: "text/markdown" });
    await first;
    assert.equal(fixture.started.length, 1);
    assert.match(runbookImportBatchId(input), /^[a-f0-9]{64}$/);
});

test("lookup/retry/cancel verify corpus ownership before acting; cancellation uses canonical server state", async () => {
    const fixture = service({ getBatchImport: async () => batch() });
    const functions = createMemoryHubRunbookImportFunctions(() => fixture);
    const other = { corpusId: "beta", batchId: "a".repeat(64) };
    await assert.rejects(
        functions.memoryHubRunbookBatch(other),
        /does not belong/,
    );
    await assert.rejects(
        functions.memoryHubRetryRunbookBatch(other),
        /does not belong/,
    );
    await assert.rejects(
        functions.memoryHubCancelRunbookBatch(other),
        /does not belong/,
    );
    assert.deepEqual(fixture.actions, []);
    const cancelled = await functions.memoryHubCancelRunbookBatch({
        ...other,
        corpusId: "alpha",
    });
    assert.equal(cancelled.state, "cancelled");
    assert.deepEqual(fixture.actions, [["cancel", other.batchId]]);
    await functions.memoryHubRetryRunbookBatch({ ...other, corpusId: "alpha" });
    assert.equal(fixture.actions[1][0], "retry");
});

test("unchanged retries after transport loss and facade restart recover without refetching mutable URLs", async () => {
    const fixture = service();
    let acquisitions = 0;
    const acquire = async (url) => {
        acquisitions++;
        return { url, text: "# Original guide", mimeType: "text/markdown" };
    };
    const input = {
        corpusId: "alpha",
        idempotencyKey: "durable",
        kind: "urls",
        urls: ["https://public.example/original"],
    };
    const first = await createMemoryHubRunbookImportFunctions(
        () => fixture,
        acquire,
    ).memoryHubStartRunbookImport(input);
    const restarted = createMemoryHubRunbookImportFunctions(
        () => fixture,
        acquire,
    );
    const retried = await restarted.memoryHubStartRunbookImport(input);
    assert.equal(retried.batch.batchId, first.batch.batchId);
    assert.equal(acquisitions, 1);
    assert.equal(fixture.started.length, 1);
    await assert.rejects(
        restarted.memoryHubStartRunbookImport({
            ...input,
            urls: ["https://public.example/changed"],
        }),
        /different acquisition/,
    );
    assert.equal(acquisitions, 1);
});

test("legacy absent or mismatching acquisition fingerprints reject before refetch even when member keys match", async () => {
    const fixture = service();
    let acquisitions = 0;
    const acquire = async (url) => {
        acquisitions++;
        return { url, text: "# Guide", mimeType: "text/markdown" };
    };
    const input = {
        corpusId: "alpha",
        idempotencyKey: "fingerprint",
        kind: "urls",
        urls: ["https://public.example/guide"],
    };
    const first = await createMemoryHubRunbookImportFunctions(
        () => fixture,
        acquire,
    ).memoryHubStartRunbookImport(input);
    for (const acquisitionFingerprint of [undefined, "0".repeat(64)]) {
        const older = {
            ...fixture,
            findBatchImport: async () => ({
                ...first.batch,
                acquisitionFingerprint,
            }),
        };
        await assert.rejects(
            createMemoryHubRunbookImportFunctions(
                () => older,
                acquire,
            ).memoryHubStartRunbookImport(input),
            /fingerprint|different acquisition/,
        );
    }
    assert.equal(acquisitions, 1);
});

test("canonical batch storage persists opaque member keys, names, warnings and rejects across restart", async () => {
    const root = path.resolve(
        ".test-fixtures",
        `runbook-import-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const host = {
        ingestDocument: async (request) => ({
            jobId: "job",
            sourceId: request.source.sourceId,
            revisionId: "revision",
            state: "complete",
            statusUri: "",
        }),
        getJob: async () => ({ state: "complete", progress: {}, warnings: [] }),
        cancelJob: async () => ({
            state: "cancelled",
            progress: {},
            warnings: [],
        }),
    };
    let store = new MemoryBatchStore(root, host);
    const facadeService = () =>
        service({
            startBatchImport: (request) => store.start(request),
            getBatchImport: (id) => store.get(id),
            findBatchImport: async (request) => {
                try {
                    return await store.get(runbookImportBatchId(request));
                } catch (error) {
                    if (error.code === "ENOENT") return undefined;
                    throw error;
                }
            },
            listBatchImports: (corpusId) => store.list(corpusId),
            retryBatchImport: (id) => store.retry(id),
            cancelBatchImport: (id) => store.cancel(id),
        });
    const input = request([
        selected(
            "export/guide.md",
            "# Guide\n\n1. Read.\n![missing](missing.png)",
        ),
        selected("export/unsupported.zip", "archive"),
        selected("export/orphan.png", png),
    ]);
    try {
        const first =
            await createMemoryHubRunbookImportFunctions(
                facadeService,
            ).memoryHubStartRunbookImport(input);
        assert(
            first.batch.members.every((member) =>
                /^[a-f0-9]{64}$/.test(member.clientKey),
            ),
        );
        assert.match(first.batch.acquisitionFingerprint, /^[a-f0-9]{64}$/);
        assert.equal(first.batch.members[1].stage, "acquisition");
        await store.close();
        store = new MemoryBatchStore(root, host);
        await store.recover();
        const restarted = createMemoryHubRunbookImportFunctions(facadeService);
        const recovered = await restarted.memoryHubStartRunbookImport(input);
        assert.equal(recovered.batch.batchId, first.batch.batchId);
        assert(
            recovered.batch.acquisitionIssues.some(
                (issue) =>
                    issue.state === "warning" &&
                    issue.reason.includes("missing.png") &&
                    issue.member === recovered.batch.members[0].clientKey,
            ),
        );
        const rejection = recovered.acquisition.find(
            (issue) => issue.state === "rejected",
        );
        assert.equal(rejection.member, "export/unsupported.zip");
        assert.equal(
            (await restarted.memoryHubRunbookBatches({ corpusId: "alpha" }))[0]
                .members[1].reason,
            `Acquisition rejected: ${rejection.reason}`,
        );
        assert.equal(recovered.batch.members[0].displayName, "Guide");
        assert.equal(recovered.batch.members[0].title, "Guide");
        assert(
            recovered.batch.warnings.some(
                (warning) =>
                    warning.includes("orphan.png") &&
                    warning.includes("not attached"),
            ),
        );
    } finally {
        await store.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("post-commit synthesis retry forwards exact retained identity without acquisition or batch ingestion", async () => {
    const identity = {
        corpusId: "alpha",
        sourceId: "source",
        revisionId: "revision",
    };
    const result = {
        ...identity,
        jobId: "new-attempt",
        state: "running",
        createdAt: "",
        updatedAt: "",
        candidateIds: [],
        warnings: [],
    };
    const calls = [];
    const fixture = service({
        requestRunbookSynthesis: async (value) => {
            calls.push(value);
            return result;
        },
    });
    const functions = createMemoryHubRunbookImportFunctions(
        () => fixture,
        async () => {
            assert.fail("Synthesis retry must not reacquire URLs");
        },
    );
    assert.deepEqual(
        await functions.memoryHubRetryRunbookSynthesis(identity),
        result,
    );
    assert.deepEqual(calls, [identity]);
    assert.deepEqual(fixture.started, []);
    assert.deepEqual(fixture.actions, []);
    const schema = runbookImportViewSchemas.memoryHubRetryRunbookSynthesis;
    assert.deepEqual(schema.parse(identity), identity);
    assert.equal(
        schema.safeParse({ ...identity, sourceId: "" }).success,
        false,
    );
    assert.equal(
        schema.safeParse({ ...identity, content: "replacement" }).success,
        false,
    );
});

test("synthesis retry exposes unsupported/stale errors and rejects returned identity mismatch", async () => {
    const identity = {
        corpusId: "alpha",
        sourceId: "source",
        revisionId: "revision",
    };
    await assert.rejects(
        createMemoryHubRunbookImportFunctions(() =>
            service(),
        ).memoryHubRetryRunbookSynthesis(identity),
        /unavailable/,
    );
    const stale = service({
        requestRunbookSynthesis: async () => {
            throw new Error("Revision is no longer ready and active");
        },
    });
    await assert.rejects(
        createMemoryHubRunbookImportFunctions(
            () => stale,
        ).memoryHubRetryRunbookSynthesis(identity),
        /no longer ready and active/,
    );
    const mismatch = service({
        requestRunbookSynthesis: async () => ({
            ...identity,
            revisionId: "other",
        }),
    });
    await assert.rejects(
        createMemoryHubRunbookImportFunctions(
            () => mismatch,
        ).memoryHubRetryRunbookSynthesis(identity),
        /another target or source revision/,
    );
    await assert.rejects(
        createMemoryHubRunbookImportFunctions(
            () => stale,
        ).memoryHubRetryRunbookSynthesis({ ...identity, revisionId: "" }),
        /exact retained source revision/,
    );
});

test("unavailable service or missing named corpus is explicit; durable interrupted batches/jobs survive a new facade", async () => {
    await assert.rejects(
        createMemoryHubRunbookImportFunctions(() => ({
            getCorpus: async () => undefined,
        })).memoryHubRunbookBatches({ corpusId: "alpha" }),
        /unavailable/,
    );
    const fixture = service({
        listBatchImports: async () => [batch("alpha", "interrupted")],
        listRunbookJobs: async () => [
            {
                jobId: "job",
                corpusId: "alpha",
                sourceId: "source",
                revisionId: "revision",
                state: "interrupted",
                candidateIds: [],
                warnings: ["Restart interrupted synthesis"],
            },
        ],
    });
    const restarted = createMemoryHubRunbookImportFunctions(() => fixture);
    assert.equal(
        (await restarted.memoryHubRunbookBatches({ corpusId: "alpha" }))[0]
            .state,
        "interrupted",
    );
    assert.equal(
        (await restarted.memoryHubRunbookJobs({ corpusId: "alpha" }))[0].state,
        "interrupted",
    );
    await assert.rejects(
        restarted.memoryHubRunbookBatches({ corpusId: "" }),
        /named/,
    );
});
