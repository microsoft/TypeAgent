// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic, offline execution test (CHANGE 3 acceptance criterion 2e):
// generates a REST handler with buildRestHandler, points it at a local
// node:http server on an ephemeral port, and exercises GET-with-path-param,
// GET-with-query, and POST-with-JSON-body — asserting the server observed
// the expected method/URL/body and that the handler surfaced the server's
// response back through createActionResultFromTextDisplay.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildRestHandler } from "../src/scaffolder/restHandlerTemplate.js";
import type { DiscoveredAction } from "../src/discovery/discoveryHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_DIR = path.resolve(__dirname, ".tmp-rest-handler-exec");

after(async () => {
    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
});

type ObservedRequest = {
    method?: string;
    url?: string;
    body: string;
};

async function startServer(
    handleRequest: (
        req: http.IncomingMessage,
        res: http.ServerResponse,
        body: string,
    ) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            handleRequest(req, res, Buffer.concat(chunks).toString("utf-8"));
        });
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

async function loadHandler(
    baseUrl: string,
    actions: DiscoveredAction[],
): Promise<{ instantiate: () => { executeAction: Function } }> {
    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
    await fs.mkdir(SCRATCH_DIR, { recursive: true });
    const source = await buildRestHandler(
        "bookApi",
        "BookApi",
        baseUrl,
        actions,
    );
    const handlerPath = path.join(SCRATCH_DIR, "bookApiActionHandler.ts");
    await fs.writeFile(handlerPath, source, "utf-8");
    // The generated handler imports "./bookApiSchema.js" purely for a type,
    // which is erased at emit time — an empty type-only stub is enough for
    // tsx's on-the-fly transpilation (no type-checking at runtime).
    await fs.writeFile(
        path.join(SCRATCH_DIR, "bookApiSchema.ts"),
        "export type BookApiActions = { actionName: string; parameters: Record<string, unknown> };\n",
        "utf-8",
    );
    // Cache-bust: each test loads a freshly written file at the same path.
    // pathToFileURL is required on Windows, where raw absolute paths
    // (e.g. "D:/...") are not valid ESM specifiers.
    const fileUrl = pathToFileURL(handlerPath);
    fileUrl.search = `t=${Date.now()}-${Math.random()}`;
    const mod = await import(fileUrl.href);
    return mod;
}

test("GET with a path parameter hits the right URL and returns the server's JSON", async () => {
    const observed: ObservedRequest[] = [];
    const { baseUrl, close } = await startServer((req, res, body) => {
        observed.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "42", title: "Dune" }));
    });
    try {
        const actions: DiscoveredAction[] = [
            {
                name: "getBook",
                method: "GET",
                path: "/books/{book_id}",
                parameters: [
                    {
                        name: "book_id",
                        type: "string",
                        required: true,
                        in: "path",
                    },
                ],
            },
        ];
        const { instantiate } = await loadHandler(baseUrl, actions);
        const agent = instantiate();
        const result: any = await agent.executeAction(
            {
                actionName: "getBook",
                parameters: { bookId: "42" },
            },
            {} as any,
        );

        assert.equal(observed.length, 1);
        assert.equal(observed[0].method, "GET");
        assert.equal(observed[0].url, "/books/42");
        assert.match(result.displayContent as string, /"title": "Dune"/);
    } finally {
        await close();
    }
});

test("GET with a query parameter is sent as a query string", async () => {
    const observed: ObservedRequest[] = [];
    const { baseUrl, close } = await startServer((req, res, body) => {
        observed.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [] }));
    });
    try {
        const actions: DiscoveredAction[] = [
            {
                name: "searchBooks",
                method: "GET",
                path: "/books",
                parameters: [
                    {
                        name: "limit",
                        type: "integer",
                        required: false,
                        in: "query",
                    },
                ],
            },
        ];
        const { instantiate } = await loadHandler(baseUrl, actions);
        const agent = instantiate();
        await agent.executeAction(
            { actionName: "searchBooks", parameters: { limit: 5 } },
            {} as any,
        );

        assert.equal(observed.length, 1);
        assert.equal(observed[0].method, "GET");
        assert.equal(observed[0].url, "/books?limit=5");
    } finally {
        await close();
    }
});

test("POST sends a JSON body and the server's method/body are observed correctly", async () => {
    const observed: ObservedRequest[] = [];
    const { baseUrl, close } = await startServer((req, res, body) => {
        observed.push({ method: req.method, url: req.url, body });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "99" }));
    });
    try {
        const actions: DiscoveredAction[] = [
            {
                name: "createBook",
                method: "POST",
                path: "/books",
                parameters: [
                    {
                        name: "title",
                        type: "string",
                        required: true,
                        in: "body",
                    },
                ],
            },
        ];
        const { instantiate } = await loadHandler(baseUrl, actions);
        const agent = instantiate();
        const result: any = await agent.executeAction(
            {
                actionName: "createBook",
                parameters: { title: "Foundation" },
            },
            {} as any,
        );

        assert.equal(observed.length, 1);
        assert.equal(observed[0].method, "POST");
        assert.equal(observed[0].url, "/books");
        assert.deepEqual(JSON.parse(observed[0].body), { title: "Foundation" });
        assert.match(result.displayContent as string, /"id": "99"/);
    } finally {
        await close();
    }
});
