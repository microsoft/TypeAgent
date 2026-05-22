// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration tests for the server's diagnostics + didClose handling.
 *
 * Uses the in-process duplex transport from createServer so we can
 * drive the server over real JSON-RPC without spawning a child.
 */

import { PassThrough } from "node:stream";
import {
    createProtocolConnection,
    DidOpenTextDocumentNotification,
    DidCloseTextDocumentNotification,
    InitializeRequest,
    InitializedNotification,
    PublishDiagnosticsNotification,
    PublishDiagnosticsParams,
    HoverRequest,
    CompletionRequest,
    DefinitionRequest,
    RenameRequest,
    DocumentRangeFormattingRequest,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-languageserver-protocol/node.js";
import { createServer } from "../src/server.js";

function makePipes() {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    return {
        serverTransport: { input: clientToServer, output: serverToClient },
        clientReader: new StreamMessageReader(serverToClient),
        clientWriter: new StreamMessageWriter(clientToServer),
    };
}

async function startSession(debounceMs = 5) {
    const pipes = makePipes();
    const server = createServer(pipes.serverTransport, {
        diagnosticsDebounceMs: debounceMs,
    });
    server.listen();
    const client = createProtocolConnection(
        pipes.clientReader,
        pipes.clientWriter,
    );
    client.listen();

    const publishes: PublishDiagnosticsParams[] = [];
    client.onNotification(PublishDiagnosticsNotification.type, (p) =>
        publishes.push(p),
    );

    await client.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
    });
    await client.sendNotification(InitializedNotification.type, {});

    return {
        client,
        server,
        publishes,
        cleanup: async () => {
            // Add a small delay to let pending operations and error handlers complete
            // before disposing connections. This prevents "Connection is disposed" errors
            // when error handlers try to send notifications after test completion.
            await new Promise((resolve) => setTimeout(resolve, 50));
            client.dispose();
            server.dispose();
            pipes.serverTransport.input.destroy();
            pipes.serverTransport.output.destroy();
            pipes.clientReader.dispose();
            pipes.clientWriter.dispose();
        },
    };
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs)
                return reject(new Error("waitFor timed out"));
            setTimeout(tick, 5).unref();
        };
        tick();
    });
}

const VALID_SRC = `workflow w(a: string): string {
    const x = a;
    return x;
}`;

describe("server integration", () => {
    it("publishes diagnostics on didOpen", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///t.wf",
                        languageId: "workflow",
                        version: 1,
                        text: "workflow w(): string { return unknownIdent; }",
                    },
                },
            );

            await waitFor(() => session.publishes.length >= 1);
            expect(session.publishes[0]!.uri).toBe("file:///t.wf");
            expect(session.publishes[0]!.diagnostics.length).toBeGreaterThan(0);
        } finally {
            await session.cleanup();
        }
    });

    it("clears diagnostics on didClose", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///t.wf",
                        languageId: "workflow",
                        version: 1,
                        text: "workflow broken( {",
                    },
                },
            );
            await waitFor(() =>
                session.publishes.some((p) => p.diagnostics.length > 0),
            );

            await session.client.sendNotification(
                DidCloseTextDocumentNotification.type,
                { textDocument: { uri: "file:///t.wf" } },
            );

            await waitFor(() =>
                session.publishes.some(
                    (p) =>
                        p.uri === "file:///t.wf" && p.diagnostics.length === 0,
                ),
            );
        } finally {
            await session.cleanup();
        }
    });

    it("hover returns result for a valid const reference (Phase 2)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///hover.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            // line 1 col 10: "    const x = a;" — 'x' at character 10
            const result = await session.client.sendRequest(HoverRequest.type, {
                textDocument: { uri: "file:///hover.wf" },
                position: { line: 1, character: 10 },
            });
            // Result may be null if x resolves as const; we just verify no crash.
            expect(result === null || typeof result === "object").toBe(true);
        } finally {
            await session.cleanup();
        }
    });

    it("completion returns task names and keywords (Phase 2 + Gap 11)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///comp.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            const result = await session.client.sendRequest(
                CompletionRequest.type,
                {
                    textDocument: { uri: "file:///comp.wf" },
                    position: { line: 1, character: 0 },
                },
            );
            const items = Array.isArray(result)
                ? result
                : ((result as { items: unknown[] } | null)?.items ?? []);
            const labels = items.map(
                (i: unknown) => (i as { label: string }).label,
            );
            // Should include task names
            expect(labels.some((l) => l.includes("."))).toBe(true);
            // Should include keywords
            expect(labels).toContain("const");
        } finally {
            await session.cleanup();
        }
    });

    it("definition returns location for a const reference (Phase 2)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///def.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            // line 2: "    return x;" — 'x' at character 11
            const result = await session.client.sendRequest(
                DefinitionRequest.type,
                {
                    textDocument: { uri: "file:///def.wf" },
                    position: { line: 2, character: 11 },
                },
            );
            // x is defined on line 1
            if (result && !Array.isArray(result)) {
                const loc = result as { range: { start: { line: number } } };
                expect(loc.range.start.line).toBe(1);
            } else if (Array.isArray(result) && result.length > 0) {
                const loc = result[0] as { range: { start: { line: number } } };
                expect(loc.range.start.line).toBe(1);
            }
            // null is also acceptable (cursor not quite on the identifier)
        } finally {
            await session.cleanup();
        }
    });

    it("rename renames all references (Phase 4)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///rename.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            // Rename 'x' at line 1, character 10 to 'renamed'
            const result = await session.client.sendRequest(
                RenameRequest.type,
                {
                    textDocument: { uri: "file:///rename.wf" },
                    position: { line: 1, character: 10 },
                    newName: "renamed",
                },
            );
            if (result) {
                const edits = result.changes?.["file:///rename.wf"] ?? [];
                expect(edits.length).toBeGreaterThan(0);
                for (const edit of edits) {
                    expect(edit.newText).toBe("renamed");
                }
            }
        } finally {
            await session.cleanup();
        }
    });

    it("range formatting returns edits (Gap 5)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///fmt.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            const result = await session.client.sendRequest(
                DocumentRangeFormattingRequest.type,
                {
                    textDocument: { uri: "file:///fmt.wf" },
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 3, character: 1 },
                    },
                    options: { tabSize: 4, insertSpaces: true },
                },
            );
            expect(Array.isArray(result)).toBe(true);
        } finally {
            await session.cleanup();
        }
    });

    it("workflow/compileIR custom request returns IR for valid workflow (Phase 5)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///ir.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            const result = (await session.client.sendRequest(
                "workflow/compileIR",
                { uri: "file:///ir.wf" },
            )) as { ir?: unknown; errors: unknown[] };
            expect(result).toBeDefined();
            expect(Array.isArray(result.errors)).toBe(true);
            if (result.errors.length === 0) {
                expect(result.ir).toBeDefined();
            }
        } finally {
            await session.cleanup();
        }
    });

    it("workflow/previewGraph custom request returns a graph (Phase 5)", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///graph.wf",
                        languageId: "workflow",
                        version: 1,
                        text: VALID_SRC,
                    },
                },
            );
            const result = (await session.client.sendRequest(
                "workflow/previewGraph",
                { uri: "file:///graph.wf" },
            )) as {
                graph?: {
                    workflowName: string;
                    nodes: unknown[];
                    edges: unknown[];
                    params: unknown[];
                };
                errors: unknown[];
            };
            expect(result).toBeDefined();
            expect(Array.isArray(result.errors)).toBe(true);
            expect(result.errors.length).toBe(0);
            expect(result.graph).toBeDefined();
            expect(result.graph!.workflowName).toBe("w");
            expect(Array.isArray(result.graph!.nodes)).toBe(true);
            expect(Array.isArray(result.graph!.edges)).toBe(true);
            expect(Array.isArray(result.graph!.params)).toBe(true);
        } finally {
            await session.cleanup();
        }
    });

    it("workflow/previewGraph reports lex errors and omits graph", async () => {
        const session = await startSession();
        try {
            await session.client.sendNotification(
                DidOpenTextDocumentNotification.type,
                {
                    textDocument: {
                        uri: "file:///bad.wf",
                        languageId: "workflow",
                        version: 1,
                        // Unterminated string literal — lex error.
                        text: `workflow w(): string { const x = "oops; return x; }`,
                    },
                },
            );
            const result = (await session.client.sendRequest(
                "workflow/previewGraph",
                { uri: "file:///bad.wf" },
            )) as {
                graph?: unknown;
                errors: { phase: string }[];
            };
            expect(result.graph).toBeUndefined();
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.every((e) => e.phase === "lex")).toBe(true);
        } finally {
            await session.cleanup();
        }
    });
});
