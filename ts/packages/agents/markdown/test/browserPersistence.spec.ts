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

    test("promotes only the active binding without adopting a newer disk revision", async () => {
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
        expect(manager.currentRevision).toBe("revision-1");

        const unbound = new DocumentManager();
        await unbound.handleSSEEvent({
            type: "primaryElected",
            bindingToken: null,
            revision: null,
        });
        expect(unbound.isPrimaryClient).toBe(true);
        expect(unbound.currentRevision).toBeNull();
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

    test("surfaces a divergent conflict without retrying or adopting its revision", async () => {
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
            "Save failed: 409 Conflict",
        );
        expect(manager.currentRevision).toBe("local-base-revision");
    });

    test("retries autosave after transient binding contention", async () => {
        const markdown = "# Pending edit\n";
        const editor = createEditor(() => markdown, "Pending edit");
        const fetchMock = jest
            .fn<() => Promise<Response>>()
            .mockResolvedValueOnce(
                Response.json(
                    {
                        error: "Another document update is already in progress for this binding",
                    },
                    { status: 409 },
                ),
            )
            .mockResolvedValueOnce(
                Response.json({
                    bindingToken: "binding-1",
                    revision: "revision-1",
                }),
            );
        globalThis.fetch = fetchMock as typeof fetch;

        const manager = new DocumentManager();
        manager.editorManager = { getEditor: () => editor };
        manager.currentBindingToken = "binding-1";
        manager.currentDocumentId = "binding-1";
        manager.currentRevision = "revision-0";

        await manager.performAutoSave();
        await manager.performAutoSave();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(manager.lastConflictedAutoSaveContent).toBeNull();
        expect(manager.lastAutoSaveContent).toBe(markdown);
        expect(manager.currentRevision).toBe("revision-1");
    });

    test("records the loaded editor baseline without adding history during navigation", async () => {
        const markdown = "# Serialized baseline\n";
        const editor = createEditor(() => markdown, "Serialized baseline");
        const pushState = jest.fn();
        const originalWindow = Object.getOwnPropertyDescriptor(
            globalThis,
            "window",
        );
        const originalDocument = Object.getOwnPropertyDescriptor(
            globalThis,
            "document",
        );
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: { history: { pushState } },
        });
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: { title: "" },
        });
        globalThis.fetch = jest.fn(async (input) => {
            if (input === "/api/switch-document") {
                return Response.json({
                    bindingToken: "binding-1",
                    documentId: "room-1",
                    boundRelativePath: "team/plan.md",
                    documentName: "plan",
                    revision: "revision-1",
                });
            }
            return new Response("# Raw baseline\n");
        }) as typeof fetch;

        const manager = new DocumentManager();
        manager.editorManager = {
            getEditor: () => editor,
            switchToDocument: jest.fn(async () => {}),
        };
        try {
            await manager.switchToDocument("team/plan.md", false);
        } finally {
            if (originalWindow) {
                Object.defineProperty(globalThis, "window", originalWindow);
            } else {
                Reflect.deleteProperty(globalThis, "window");
            }
            if (originalDocument) {
                Object.defineProperty(globalThis, "document", originalDocument);
            } else {
                Reflect.deleteProperty(globalThis, "document");
            }
        }

        expect(manager.lastAutoSaveContent).toBe(markdown);
        expect(pushState).not.toHaveBeenCalled();
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

    test("ignores switch responses superseded by a newer binding", async () => {
        let resolveSwitch!: (response: Response) => void;
        globalThis.fetch = jest.fn(
            () =>
                new Promise<Response>((resolve) => {
                    resolveSwitch = resolve;
                }),
        ) as typeof fetch;

        const manager = new DocumentManager();
        const switching = manager.switchToDocument("old.md");
        await Promise.resolve();
        await manager.handleSSEEvent({
            type: "bindingBootstrap",
            bindingToken: "new-binding",
            documentId: "new-room",
            boundRelativePath: "new.md",
            revision: "new-revision",
        });
        resolveSwitch(
            Response.json({
                bindingToken: "old-binding",
                documentId: "old-room",
                boundRelativePath: "old.md",
                revision: "old-revision",
                content: "old content",
            }),
        );
        await switching;

        expect(manager.currentBindingToken).toBe("new-binding");
        expect(manager.currentDocumentId).toBe("new-room");
        expect(manager.currentBoundRelativePath).toBe("new.md");
        expect(manager.currentRevision).toBe("new-revision");
    });

    test("ignores incomplete binding bootstrap data", async () => {
        const manager = new DocumentManager();
        manager.currentBindingToken = "binding-1";
        manager.currentDocumentId = "room-1";
        manager.currentBoundRelativePath = "one.md";

        await manager.handleSSEEvent({
            type: "bindingBootstrap",
            bindingToken: "binding-2",
            documentId: "room-2",
        });

        expect(manager.currentBindingToken).toBe("binding-1");
        expect(manager.currentDocumentId).toBe("room-1");
        expect(manager.currentBoundRelativePath).toBe("one.md");
    });

    test("collaboration config uses the server room id, not the basename", async () => {
        globalThis.fetch = (async () =>
            Response.json({
                websocketServerUrl: "ws://127.0.0.1:4321",
                currentDocumentId: "opaque-binding-token",
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
