// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import { createServer, type ViteDevServer } from "vite";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("browser document persistence", () => {
    let vite: ViteDevServer;
    let DocumentManager: new () => any;
    let CollaborationManager: new () => any;
    const originalFetch = globalThis.fetch;

    beforeAll(async () => {
        vite = await createServer({
            root: packageRoot,
            appType: "custom",
            logLevel: "silent",
            server: { middlewareMode: true },
        });
        ({ DocumentManager } = await vite.ssrLoadModule(
            "/src/view/site/core/document-manager.ts",
        ));
        ({ CollaborationManager } = await vite.ssrLoadModule(
            "/src/view/site/core/collaboration-manager.ts",
        ));
    });

    beforeEach(() => {
        jest.spyOn(console, "log").mockImplementation(() => {});
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await vite.close();
    });

    test("autosave and saveDocument persist serializer Markdown, including formatting-only edits", async () => {
        let markdown =
            "# Heading\n\nParagraph with **bold** text.\n\n```ts\nconst x = 1;\n```\n";
        const editor = createEditor(
            () => markdown,
            "HeadingParagraph with bold text.const x = 1;",
        );
        const requests: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(JSON.parse(init?.body as string));
            return Response.json({ revision: `revision-${requests.length}` });
        }) as typeof fetch;

        const manager = new DocumentManager();
        manager.editorManager = { getEditor: () => editor };
        manager.isPrimaryClient = true;
        manager.currentBindingToken = "binding-1";
        manager.currentDocumentId = "binding-1";
        manager.currentRevision = "revision-0";

        await manager.performAutoSave();
        markdown =
            "# Heading\n\nParagraph with *bold* text.\n\n```ts\nconst x = 1;\n```\n";
        await manager.performAutoSave();
        await manager.saveDocument(editor);

        expect(requests).toHaveLength(3);
        expect(requests[0]).toMatchObject({
            content:
                "# Heading\n\nParagraph with **bold** text.\n\n```ts\nconst x = 1;\n```\n",
            bindingToken: "binding-1",
            expectedRevision: "revision-0",
        });
        expect(requests[1]).toMatchObject({
            content:
                "# Heading\n\nParagraph with *bold* text.\n\n```ts\nconst x = 1;\n```\n",
            expectedRevision: "revision-1",
        });
        expect(requests[2]).toMatchObject({
            content:
                "# Heading\n\nParagraph with *bold* text.\n\n```ts\nconst x = 1;\n```\n",
            expectedRevision: "revision-2",
        });
    });

    test("serializer failure aborts persistence instead of falling back to textContent", async () => {
        const editor = {
            action(callback: (ctx: { get: () => unknown }) => void): void {
                let getCount = 0;
                callback({
                    get: () => {
                        if (getCount++ === 0) {
                            return {
                                state: {
                                    doc: { textContent: "formatting was lost" },
                                },
                            };
                        }
                        throw new Error("serializer unavailable");
                    },
                });
            },
        };
        const fetchMock = jest.fn();
        globalThis.fetch = fetchMock as typeof fetch;

        const manager = new DocumentManager();
        manager.currentBindingToken = "binding-1";
        manager.currentRevision = "revision-0";

        await expect(manager.saveDocument(editor)).rejects.toThrow(
            "serializer unavailable",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test("adopts current revisions from autosave and primary promotion events", async () => {
        const manager = new DocumentManager();
        manager.currentBindingToken = "binding-1";
        manager.currentRevision = "revision-0";

        await manager.handleSSEEvent({
            type: "autoSave",
            bindingToken: "binding-1",
            revision: "revision-1",
        });
        expect(manager.currentRevision).toBe("revision-1");

        await manager.handleSSEEvent({
            type: "autoSave",
            bindingToken: "stale-binding",
            revision: "wrong-revision",
        });
        expect(manager.currentRevision).toBe("revision-1");

        await manager.handleSSEEvent({
            type: "primaryElected",
            bindingToken: "stale-binding",
            revision: "wrong-revision",
        });
        expect(manager.isPrimaryClient).toBe(false);
        expect(manager.currentRevision).toBe("revision-1");

        await manager.handleSSEEvent({
            type: "primaryElected",
            bindingToken: "binding-1",
            revision: "revision-2",
        });
        expect(manager.isPrimaryClient).toBe(true);
        expect(manager.currentRevision).toBe("revision-2");
    });

    test("reconciles a 409 only when the same content is already on disk", async () => {
        const markdown = "# Shared edit\n";
        const editor = createEditor(() => markdown, "Shared edit");
        const fetchMock = jest.fn(async () =>
            Response.json(
                {
                    error: "Document content changed since it was loaded.",
                    content: markdown,
                    revision: "revision-from-primary",
                },
                { status: 409 },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const manager = new DocumentManager();
        manager.editorManager = { getEditor: () => editor };
        manager.currentBindingToken = "binding-1";
        manager.currentDocumentId = "binding-1";
        manager.currentRevision = "stale-revision";

        await manager.performAutoSave();
        await manager.performAutoSave();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(manager.currentRevision).toBe("revision-from-primary");
        expect(manager.lastAutoSaveContent).toBe(markdown);
    });

    test("surfaces a divergent or malformed 409 without retrying or adopting its revision", async () => {
        const markdown = "# Local edit\n";
        const editor = createEditor(() => markdown, "Local edit");
        const fetchMock = jest
            .fn<() => Promise<Response>>()
            .mockResolvedValueOnce(
                Response.json(
                    {
                        error: "Document content changed since it was loaded.",
                        content: "# Newer disk edit\n",
                        revision: "newer-disk-revision",
                    },
                    { status: 409 },
                ),
            )
            .mockResolvedValue(
                new Response("not-json", {
                    status: 409,
                    statusText: "Conflict",
                }),
            );
        globalThis.fetch = fetchMock as typeof fetch;

        const manager = new DocumentManager();
        manager.editorManager = { getEditor: () => editor };
        manager.currentBindingToken = "binding-1";
        manager.currentDocumentId = "binding-1";
        manager.currentRevision = "local-base-revision";

        await manager.performAutoSave();
        await manager.performAutoSave();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(manager.currentRevision).toBe("local-base-revision");
        expect(console.error).toHaveBeenCalledWith(
            "[AUTO-SAVE] Error during auto-save:",
            expect.objectContaining({ name: "DocumentWriteConflictError" }),
        );

        manager.lastConflictedAutoSaveContent = null;
        await expect(manager.saveDocument(editor)).rejects.toThrow(
            "changed on disk and was not overwritten",
        );
        expect(manager.currentRevision).toBe("local-base-revision");
    });

    test("matching bootstrap path skips a redundant switch request", async () => {
        const fetchMock = jest.fn(async () =>
            Response.json({
                boundRelativePath: "team/2025/plan.md",
            }),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const manager = new DocumentManager();
        try {
            await manager.initialize();
            await manager.switchToDocument("team/2025/plan.md");
        } finally {
            manager.destroy();
        }

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/current-document");
    });

    test("collaboration config uses the server room id, not the basename", async () => {
        globalThis.fetch = (async () =>
            Response.json({
                websocketServerUrl: "ws://127.0.0.1:4321",
                documentId: "opaque-binding-token",
                currentDocument: "note",
                documents: 1,
                totalClients: 0,
            })) as typeof fetch;

        const manager = new CollaborationManager();
        const config = await manager.getCollaborationConfig();

        expect(config.documentId).toBe("opaque-binding-token");
    });
});

function createEditor(
    getMarkdown: () => string,
    textContent: string,
): {
    action(callback: (ctx: { get: () => unknown }) => void): void;
} {
    return {
        action(callback): void {
            let getCount = 0;
            callback({
                get: () =>
                    getCount++ === 0
                        ? { state: { doc: { textContent } } }
                        : () => getMarkdown(),
            });
        },
    };
}
