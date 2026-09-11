// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import { createServer, type ViteDevServer } from "vite";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("browser document binding", () => {
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

    test("echoes the active binding in serializer responses", async () => {
        const requests: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(JSON.parse(init?.body as string));
            return Response.json({ success: true });
        }) as typeof fetch;

        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";
        manager.editorManager = {
            getEditor: () => createEditor(() => "# Current\n"),
        };

        await manager.handleMarkdownRequest("request-1");

        expect(requests).toEqual([
            expect.objectContaining({
                requestId: "request-1",
                markdown: "# Current\n",
                bindingToken: "binding-1",
            }),
        ]);
    });

    test("rejects serializer requests until the editor is ready", async () => {
        const requests: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(JSON.parse(init?.body as string));
            return Response.json({ success: true });
        }) as typeof fetch;

        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";

        await manager.handleMarkdownRequest("request-1");

        expect(requests).toEqual([
            expect.objectContaining({
                requestId: "request-1",
                error: "Editor is not ready to serialize Markdown",
                bindingToken: "binding-1",
            }),
        ]);
    });

    test("sends and advances binding revisions on document saves", async () => {
        const requests: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_input, init) => {
            requests.push(JSON.parse(init?.body as string));
            return Response.json({
                bindingToken: "binding-1",
                revision: "revision-2",
            });
        }) as typeof fetch;

        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";
        manager.revision = "revision-1";

        await manager.saveDocument(createEditor(() => "# Saved\n"));

        expect(requests).toEqual([
            {
                content: "# Saved\n",
                bindingToken: "binding-1",
                expectedRevision: "revision-1",
            },
        ]);
        expect(manager.revision).toBe("revision-2");
    });

    test("applies matching server snapshots to the editor", async () => {
        const setContent = jest.fn(async () => {});
        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";
        manager.editorManager = {
            getEditor: () => createEditor(() => "# Current\n"),
            setContent,
        };

        await manager.handleSSEEvent({
            type: "documentSnapshot",
            bindingToken: "binding-1",
            baseMarkdown: "# Current\n",
            markdown: "# Updated\n",
            revision: "revision-2",
        });

        expect(setContent).toHaveBeenCalledWith("# Updated\n");
        expect(manager.revision).toBe("revision-2");
    });

    test("does not overwrite edits made after an agent read", async () => {
        const setContent = jest.fn(async () => {});
        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";
        manager.editorManager = {
            getEditor: () => createEditor(() => "# User edit\n"),
            setContent,
        };

        await manager.handleSSEEvent({
            type: "documentSnapshot",
            bindingToken: "binding-1",
            baseMarkdown: "# Earlier\n",
            markdown: "# AI update\n",
            revision: "revision-2",
        });

        expect(setContent).not.toHaveBeenCalled();
        expect(manager.revision).toBeNull();
    });

    test("adopts a snapshot revision already synchronized by Yjs", async () => {
        const setContent = jest.fn(async () => {});
        const manager = new DocumentManager();
        manager.bindingToken = "binding-1";
        manager.editorManager = {
            getEditor: () => createEditor(() => "# AI update\n"),
            setContent,
        };

        await manager.handleSSEEvent({
            type: "documentSnapshot",
            bindingToken: "binding-1",
            baseMarkdown: "# Earlier\n",
            markdown: "# AI update\n",
            revision: "revision-2",
        });

        expect(setContent).not.toHaveBeenCalled();
        expect(manager.revision).toBe("revision-2");
    });

    test("uses the server room id instead of the display basename", async () => {
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

function createEditor(getMarkdown: () => string): {
    action(callback: (ctx: { get: () => unknown }) => void): void;
} {
    return {
        action(callback): void {
            let getCount = 0;
            callback({
                get: () =>
                    getCount++ === 0
                        ? {
                              state: {
                                  doc: { textContent: "Current" },
                                  selection: {
                                      head: 0,
                                      empty: true,
                                      from: 0,
                                      to: 0,
                                  },
                              },
                          }
                        : () => getMarkdown(),
            });
        },
    };
}
