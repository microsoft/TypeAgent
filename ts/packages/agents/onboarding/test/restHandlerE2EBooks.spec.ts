// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Tier-A end-to-end onboarding pipeline check (offline/deterministic): runs
// the full parseOpenApiSpec discovery pipeline (including a $ref-resolved
// path parameter — the Fix 1 regression scenario) against an OpenAPI 3
// "books" spec whose `servers[0].url` is an absolute URL pointing at a
// local node:http server WITH a base path ("/v2", to also exercise
// base-path preservation), then scaffolds a REST handler from the
// resulting ApiSurface, type-checks it, and executes it against that same
// local server for a GET-with-path-param, a GET-with-query, and a
// POST-with-JSON-body action. Asserts the server observed the correct
// method/URL/body for each request (base path preserved, $ref path param
// substituted — never "undefined" — query encoded, JSON body sent) and
// that real response data flows back through the handler's
// createActionResultFromTextDisplay result.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
    extractOpenApiActions,
    resolveOpenApiBaseUrl,
} from "../src/discovery/discoveryHandler.js";
import {
    buildRestHandler,
    filterRestActions,
} from "../src/scaffolder/restHandlerTemplate.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_DIR = path.resolve(__dirname, ".tmp-rest-e2e-books");

after(async () => {
    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
});

type ObservedRequest = { method?: string; url?: string; body: string };

async function startBooksServer(): Promise<{
    baseOrigin: string;
    observed: ObservedRequest[];
    close: () => Promise<void>;
}> {
    const observed: ObservedRequest[] = [];
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf-8");
            observed.push({ method: req.method, url: req.url, body });

            if (req.method === "GET" && req.url?.startsWith("/v2/books/")) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ id: "book-42", title: "Dune" }));
                return;
            }
            if (req.method === "GET" && req.url?.startsWith("/v2/books")) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ results: ["Dune", "Foundation"] }));
                return;
            }
            if (req.method === "POST" && req.url === "/v2/books") {
                res.writeHead(201, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ id: "book-99", created: true }));
                return;
            }
            res.writeHead(404);
            res.end("not found");
        });
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    return {
        baseOrigin: `http://127.0.0.1:${port}`,
        observed,
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

function buildBooksSpec(baseOrigin: string) {
    return {
        openapi: "3.0.0",
        info: { title: "Books API", version: "1.0.0" },
        // Absolute server URL WITH a base path ("/v2") — exercises base-path
        // preservation end to end, independent of the (local, non-http)
        // spec source.
        servers: [{ url: `${baseOrigin}/v2` }],
        components: {
            parameters: {
                BookId: {
                    name: "bookId",
                    in: "path",
                    required: true,
                    schema: { type: "string" },
                },
            },
        },
        paths: {
            "/books/{bookId}": {
                // Path-level $ref parameter — the Fix 1 regression scenario:
                // must resolve inline rather than silently drop, or the
                // generated handler would substitute the literal string
                // "undefined" into the request URL.
                parameters: [{ $ref: "#/components/parameters/BookId" }],
                get: {
                    operationId: "get_book",
                    summary: "Get a book by id",
                    responses: { "200": { description: "ok" } },
                },
            },
            "/books": {
                get: {
                    operationId: "search_books",
                    summary: "Search books",
                    parameters: [
                        {
                            name: "limit",
                            in: "query",
                            required: false,
                            schema: { type: "integer" },
                        },
                    ],
                    responses: { "200": { description: "ok" } },
                },
                post: {
                    operationId: "create_book",
                    summary: "Create a book",
                    requestBody: {
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                    },
                                    required: ["title"],
                                },
                            },
                        },
                    },
                    responses: { "201": { description: "created" } },
                },
            },
        },
    };
}

test("Tier A: parseOpenApiSpec discovery + buildRestHandler scaffolding + real local-HTTP execution for a books API", async (t) => {
    const { baseOrigin, observed, close } = await startBooksServer();
    t.after(() => close());

    // --- Discovery phase (parseOpenApiSpec arm) ---
    const specSource = "./local-books-spec.json"; // local, non-http source
    const spec = buildBooksSpec(baseOrigin);

    const baseUrl = resolveOpenApiBaseUrl(spec, specSource, specSource);
    assert.equal(
        baseUrl,
        `${baseOrigin}/v2`,
        "expected the absolute server URL (with its /v2 base path) to be captured verbatim",
    );

    const actions = extractOpenApiActions(spec, specSource);
    assert.equal(actions.length, 3);

    const getBook = actions.find((a) => a.name === "getBook");
    assert.ok(getBook, "expected a getBook action");
    const bookIdParam = getBook!.parameters?.find((p) => p.name === "bookId");
    assert.ok(
        bookIdParam,
        "expected the $ref'd path-level bookId parameter to have been resolved and merged onto get_book",
    );
    assert.equal(bookIdParam?.in, "path");
    assert.equal(bookIdParam?.required, true);

    const searchBooks = actions.find((a) => a.name === "searchBooks");
    const limitParam = searchBooks?.parameters?.find((p) => p.name === "limit");
    assert.equal(limitParam?.in, "query");

    const createBook = actions.find((a) => a.name === "createBook");
    const titleParam = createBook?.parameters?.find((p) => p.name === "title");
    assert.equal(titleParam?.in, "body");

    // --- Scaffolding phase (buildRestHandler) ---
    const restActions = filterRestActions(actions);
    assert.equal(
        restActions.length,
        3,
        "all three actions should be eligible for REST generation (the $ref path param must have resolved, or getBook would have been excluded by the Fix-1 safety net)",
    );

    await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
    await fs.mkdir(SCRATCH_DIR, { recursive: true });
    const handlerSource = await buildRestHandler(
        "booksApi",
        "BooksApi",
        baseUrl!,
        restActions,
    );
    const handlerPath = path.join(SCRATCH_DIR, "booksApiActionHandler.ts");
    await fs.writeFile(handlerPath, handlerSource, "utf-8");
    await fs.writeFile(
        path.join(SCRATCH_DIR, "booksApiSchema.ts"),
        "export type BooksApiActions = { actionName: string; parameters: Record<string, unknown> };\n",
        "utf-8",
    );

    // --- Compile check ---
    await fs.writeFile(
        path.join(SCRATCH_DIR, "tsconfig.json"),
        JSON.stringify(
            {
                compilerOptions: {
                    target: "es2021",
                    lib: ["es2021"],
                    module: "node16",
                    moduleResolution: "node16",
                    types: ["node"],
                    esModuleInterop: true,
                    skipLibCheck: true,
                    strict: true,
                    noEmit: true,
                },
                include: ["*.ts"],
            },
            null,
            2,
        ),
        "utf-8",
    );
    const tscBin = path.resolve(
        __dirname,
        "../node_modules/typescript/bin/tsc",
    );
    try {
        await execFileAsync(process.execPath, [tscBin, "-p", SCRATCH_DIR], {
            cwd: SCRATCH_DIR,
        });
    } catch (err: any) {
        assert.fail(
            `Generated books REST handler failed to type-check:\n${err.stdout ?? err.message}`,
        );
    }

    // --- Execution phase: real HTTP calls against the local server ---
    const fileUrl = pathToFileURL(handlerPath);
    fileUrl.search = `t=${Date.now()}-${Math.random()}`;
    const mod = await import(fileUrl.href);
    const agent = mod.instantiate();

    // 1. GET with a $ref-resolved path param.
    const getResult: any = await agent.executeAction(
        { actionName: "getBook", parameters: { bookId: "book-42" } },
        {} as any,
    );
    assert.equal(observed.length, 1);
    assert.equal(observed[0].method, "GET");
    assert.equal(
        observed[0].url,
        "/v2/books/book-42",
        "expected the /v2 base path preserved and the $ref-resolved bookId substituted (not 'undefined')",
    );
    assert.doesNotMatch(observed[0].url ?? "", /undefined/);
    assert.match(getResult.displayContent as string, /"title": "Dune"/);

    // 2. GET with a query param.
    await agent.executeAction(
        { actionName: "searchBooks", parameters: { limit: 2 } },
        {} as any,
    );
    assert.equal(observed.length, 2);
    assert.equal(observed[1].method, "GET");
    assert.equal(observed[1].url, "/v2/books?limit=2");

    // 3. POST with a JSON body.
    const postResult: any = await agent.executeAction(
        { actionName: "createBook", parameters: { title: "Foundation" } },
        {} as any,
    );
    assert.equal(observed.length, 3);
    assert.equal(observed[2].method, "POST");
    assert.equal(observed[2].url, "/v2/books");
    assert.deepEqual(JSON.parse(observed[2].body), { title: "Foundation" });
    assert.match(postResult.displayContent as string, /"created": true/);
});
