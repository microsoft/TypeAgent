// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    createDocumentFixture,
    parseFixtureOptions,
} from "../macro-eval-fixture.mjs";

function corpus() {
    return {
        protocolVersion: "macro-user-e2e-v1",
        status: "ready-for-rehearsal-unexecuted",
        familyId: "exact-document-lookup-fetch",
        documents: [
            {
                key: "a",
                title: "Exact A",
                expectedId: "synthetic-doc-a",
                content: "Exact A\nFIRST\nComplete document body\nLAST",
            },
        ],
        training: [],
        heldOutPositive: [],
        negativeOrAmbiguous: [],
        contextualConversations: [],
    };
}

test("fixture returns exact corpus identities/content, truthful missing errors, and owned audit", async () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-fixture-"),
    );
    const auditPath = path.join(directory, "audit.jsonl");
    const fixture = createDocumentFixture({ corpus: corpus(), auditPath });
    try {
        assert.equal(fixture.tools.length, 2);
        assert.ok(
            fixture.tools.every(
                (tool) =>
                    tool.annotations.readOnlyHint &&
                    !tool.annotations.destructiveHint,
            ),
        );
        const lookup = await fixture.callTool("lookup_document", {
            title: "Exact A",
        });
        assert.equal(lookup.structuredContent.id, "synthetic-doc-a");
        const fetched = await fixture.callTool("fetch_document", {
            id: lookup.structuredContent.id,
        });
        assert.equal(
            fetched.structuredContent.content,
            corpus().documents[0].content,
        );
        const missing = await fixture.callTool("lookup_document", {
            title: "exact a",
        });
        assert.deepEqual(missing.structuredContent, {
            found: false,
            id: null,
            title: "exact a",
        });
        assert.equal(
            (await fixture.callTool("fetch_document", { id: "doc-a" })).isError,
            true,
        );
        for (const [name, args] of [
            ["delete_document", { id: "synthetic-doc-a" }],
            ["lookup_document", { title: "Exact A", extra: "forbidden" }],
            ["lookup_document", { title: 42 }],
            ["fetch_document", {}],
            ["fetch_document", null],
        ])
            assert.equal((await fixture.callTool(name, args)).isError, true);
        const calls = fs
            .readFileSync(auditPath, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.equal(calls.length, 9);
        assert.equal(calls[0].returnedId, "synthetic-doc-a");
        assert.equal(calls[1].id, calls[0].returnedId);
        assert.equal(calls[2].returnedId, null);
        assert.ok(
            calls.every((call) => Number.isFinite(Date.parse(call.timestamp))),
        );
        assert.throws(
            () => createDocumentFixture({ corpus: corpus(), auditPath }),
            /EEXIST/,
        );
        assert.throws(
            () => createDocumentFixture({ corpus: corpus() }),
            /owned audit/,
        );
        fixture.close();
        await assert.rejects(
            () => fixture.callTool("fetch_document", { id: "synthetic-doc-a" }),
            /closed/,
        );
    } finally {
        fixture.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("fixture options require audit, reject unsupported/duplicate flags and permit env defaults", () => {
    assert.deepEqual(
        parseFixtureOptions(["--corpus", "c.json", "--audit", "a.jsonl"], {}),
        { corpusPath: "c.json", auditPath: "a.jsonl", appendAudit: false },
    );
    assert.deepEqual(
        parseFixtureOptions([], {
            MACRO_EVAL_CORPUS: "c",
            MACRO_EVAL_AUDIT: "a",
        }),
        { corpusPath: "c", auditPath: "a", appendAudit: false },
    );
    assert.deepEqual(
        parseFixtureOptions(
            ["--append-audit", "--audit", "a", "--corpus", "c"],
            {},
        ),
        { corpusPath: "c", auditPath: "a", appendAudit: true },
    );
    assert.deepEqual(
        parseFixtureOptions(["--append-audit"], {
            MACRO_EVAL_CORPUS: "c",
            MACRO_EVAL_AUDIT: "a",
        }),
        { corpusPath: "c", auditPath: "a", appendAudit: true },
    );
    for (const args of [
        [],
        ["--corpus", "c"],
        ["--corpus", "c", "--audit"],
        ["--corpus", "c", "--audit", "c"],
        ["--corpus", "c", "--unknown", "a"],
        ["--corpus", "c", "--corpus", "d", "--audit", "a"],
        ["--corpus", "c", "--audit", "a", "--append-audit", "--append-audit"],
        ["--corpus", "c", "--audit", "a", "--append-audit", "true"],
    ])
        assert.throws(() => parseFixtureOptions(args, {}));
});

test("explicit append permits a second producer and restart without changing prior audit entries", async () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-append-"),
    );
    const auditPath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(auditPath, "");
    const first = createDocumentFixture({
        corpus: corpus(),
        auditPath,
        appendAudit: true,
    });
    const second = createDocumentFixture({
        corpus: corpus(),
        auditPath,
        appendAudit: true,
    });
    let restarted;
    try {
        assert.throws(
            () => createDocumentFixture({ corpus: corpus(), auditPath }),
            /EEXIST/,
        );
        await first.callTool("lookup_document", { title: "Exact A" });
        const prior = fs.readFileSync(auditPath, "utf8");
        await second.callTool("fetch_document", { id: "synthetic-doc-a" });
        assert.ok(fs.readFileSync(auditPath, "utf8").startsWith(prior));
        first.close();
        restarted = createDocumentFixture({
            corpus: corpus(),
            auditPath,
            appendAudit: true,
        });
        await restarted.callTool("lookup_document", {
            title: "Missing exact title",
        });
        await second.callTool("fetch_document", { id: "synthetic-doc-a" });
        const entries = fs
            .readFileSync(auditPath, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse);
        assert.deepEqual(
            entries.map((entry) => entry.operation),
            [
                "lookup_document",
                "fetch_document",
                "lookup_document",
                "fetch_document",
            ],
        );
        assert.equal(entries[2].returnedId, null);
        assert.equal(fs.readdirSync(directory).length, 1);
        await restarted.callTool("", {});
        await restarted.callTool({ unsupported: "name shape" }, {});
        const afterRejected = createDocumentFixture({
            corpus: corpus(),
            auditPath,
            appendAudit: true,
        });
        afterRejected.close();
    } finally {
        first.close();
        second.close();
        restarted?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("append rejects missing, nonregular, symlink, wrong-format and partial audit files without writes", () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-append-invalid-"),
    );
    const auditPath = path.join(directory, "audit.jsonl");
    const append = (file) =>
        createDocumentFixture({
            corpus: corpus(),
            auditPath: file,
            appendAudit: true,
        });
    try {
        assert.throws(
            () => append(path.join(directory, "missing.jsonl")),
            /Invalid owned audit file for append.*ENOENT/,
        );
        assert.throws(
            () => append(path.join(directory, "missing-parent", "audit.jsonl")),
            /Invalid owned audit file for append.*ENOENT/,
        );
        assert.equal(
            fs.existsSync(path.join(directory, "missing-parent")),
            false,
        );
        assert.throws(() => append(directory), /regular non-symlink/);
        assert.throws(
            () =>
                createDocumentFixture({
                    corpus: corpus(),
                    auditPath,
                    appendAudit: "true",
                }),
            /must be a boolean/,
        );
        for (const contents of [
            JSON.stringify(corpus()),
            "not-json\n",
            "\n",
            "null\n",
            "[]\n",
            '{"timestamp":"invalid","operation":"fetch_document","id":"x"}\n',
            '{"timestamp":"2026-10-12T00:00:00Z","operation":"unknown"}\n',
            '{"timestamp":"2026-10-12T00:00:00Z","operation":"lookup_document","title":"Exact A"}\n',
            '{"timestamp":"2026-10-12T00:00:00Z","operation":"fetch_document","id":"x"}',
            '{"timestamp":"2026-10-12T00:00:00Z","operation":"fetch_document"',
        ]) {
            fs.writeFileSync(auditPath, contents);
            assert.throws(
                () => append(auditPath),
                /Invalid owned audit file for append/,
            );
            assert.equal(fs.readFileSync(auditPath, "utf8"), contents);
        }
        fs.writeFileSync(auditPath, "");
        const invalidUtf8 = Buffer.from([
            ...Buffer.from(
                '{"timestamp":"2026-10-12T00:00:00Z","operation":"fetch_document","id":"',
            ),
            0xff,
            ...Buffer.from('"}\n'),
        ]);
        fs.writeFileSync(auditPath, invalidUtf8);
        assert.throws(
            () => append(auditPath),
            /Invalid owned audit file for append/,
        );
        assert.deepEqual(fs.readFileSync(auditPath), invalidUtf8);
        fs.writeFileSync(auditPath, "");
        const symlinkPath = path.join(directory, "audit-link.jsonl");
        fs.symlinkSync(auditPath, symlinkPath, "file");
        assert.equal(fs.lstatSync(symlinkPath).isSymbolicLink(), true);
        assert.throws(() => append(symlinkPath), /regular non-symlink/);
        assert.equal(fs.readFileSync(auditPath, "utf8"), "");
        assert.equal(fs.readdirSync(directory).length, 2);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

async function connectFixture(corpusPath, auditPath) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            path.resolve(import.meta.dirname, "..", "macro-eval-fixture.mjs"),
            "--corpus",
            corpusPath,
            "--audit",
            auditPath,
            "--append-audit",
        ],
        stderr: "pipe",
    });
    const client = new Client({
        name: "offline-append-test",
        version: "1.0.0",
    });
    try {
        await client.connect(transport);
    } catch (error) {
        await transport.close();
        throw error;
    }
    return {
        client,
        close: async () => {
            await client.close();
            await transport.close();
        },
    };
}

test("two real MCP stdio producers and a genuine restart append to the same owned audit", async () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-append-stdio-"),
    );
    const corpusPath = path.join(directory, "corpus.json");
    const auditPath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(corpusPath, JSON.stringify(corpus()));
    fs.writeFileSync(auditPath, "");
    const connections = [];
    try {
        const first = await connectFixture(corpusPath, auditPath);
        connections.push(first);
        const second = await connectFixture(corpusPath, auditPath);
        connections.push(second);
        const lookup = await first.client.callTool({
            name: "lookup_document",
            arguments: { title: "Exact A" },
        });
        const prior = fs.readFileSync(auditPath, "utf8");
        const fetch = await second.client.callTool({
            name: "fetch_document",
            arguments: { id: lookup.structuredContent.id },
        });
        assert.equal(
            fetch.structuredContent.content,
            corpus().documents[0].content,
        );
        assert.ok(fs.readFileSync(auditPath, "utf8").startsWith(prior));
        await first.close();
        connections.shift();
        const restarted = await connectFixture(corpusPath, auditPath);
        connections.push(restarted);
        await restarted.client.callTool({
            name: "lookup_document",
            arguments: { title: "Missing exact title" },
        });
        await second.client.callTool({
            name: "fetch_document",
            arguments: { id: lookup.structuredContent.id },
        });
        const contents = fs.readFileSync(auditPath, "utf8");
        assert.ok(contents.startsWith(prior));
        const records = contents.trim().split("\n").map(JSON.parse);
        assert.deepEqual(
            records.map((entry) => entry.operation),
            [
                "lookup_document",
                "fetch_document",
                "lookup_document",
                "fetch_document",
            ],
        );
        assert.equal(records[2].returnedId, null);
        const previousEntries = fs.readFileSync(auditPath, "utf8");
        await Promise.all([
            second.client.callTool({
                name: "lookup_document",
                arguments: { title: "Concurrent missing title A" },
            }),
            restarted.client.callTool({
                name: "lookup_document",
                arguments: { title: "Concurrent missing title B" },
            }),
        ]);
        const appended = fs.readFileSync(auditPath, "utf8");
        assert.ok(appended.startsWith(previousEntries));
        const concurrent = appended.trim().split("\n").map(JSON.parse).slice(4);
        assert.deepEqual(concurrent.map((entry) => entry.title).sort(), [
            "Concurrent missing title A",
            "Concurrent missing title B",
        ]);
    } finally {
        await Promise.all(connections.map((connection) => connection.close()));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("packaged fixture serves real MCP stdio requests without session-absolute dependencies", async () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-mcp-"),
    );
    const corpusPath = path.join(directory, "corpus.json");
    const auditPath = path.join(directory, "audit.jsonl");
    fs.writeFileSync(corpusPath, JSON.stringify(corpus()));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            path.resolve(import.meta.dirname, "..", "macro-eval-fixture.mjs"),
            "--corpus",
            corpusPath,
            "--audit",
            auditPath,
        ],
        stderr: "pipe",
    });
    const client = new Client({
        name: "offline-fixture-test",
        version: "1.0.0",
    });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(
            listed.tools.map((entry) => entry.name),
            ["lookup_document", "fetch_document"],
        );
        const lookup = await client.callTool({
            name: "lookup_document",
            arguments: { title: "Exact A" },
        });
        const fetch = await client.callTool({
            name: "fetch_document",
            arguments: { id: lookup.structuredContent.id },
        });
        assert.equal(
            fetch.structuredContent.content,
            corpus().documents[0].content,
        );
        const missing = await client.callTool({
            name: "fetch_document",
            arguments: { id: "doc-a" },
        });
        assert.equal(missing.isError, true);
        assert.equal(
            fs.readFileSync(auditPath, "utf8").trim().split("\n").length,
            3,
        );
    } finally {
        await client.close();
        await transport.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
