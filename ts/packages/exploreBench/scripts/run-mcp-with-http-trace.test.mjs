// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
    parseWrapperArgs,
    runBenchmarkWithTrace,
    startTraceProxy,
} from "./run-mcp-with-http-trace.mjs";

test("records exact JSON request and response while redacting credentials", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const responseHeaderName = ["x-api", "key"].join("-");
    const responseHeaderValue = ["response", "secret"].join("-");
    const sessionHeaderName = ["x-amz-security", "token"].join("-");
    const sessionHeaderValue = ["session", "secret"].join("-");
    let observed;
    const upstream = await startServer(async (request, response) => {
        observed = {
            url: request.url,
            authorization: request.headers.authorization,
            subscriptionKey: request.headers["ocp-apim-subscription-key"],
            securityToken: request.headers["x-amz-security-token"],
            body: (await readRequest(request)).toString("utf8"),
        };
        const body = Buffer.from('{"ok":true}');
        response.writeHead(201, {
            "content-type": "application/json",
            "content-length": String(body.length),
            [responseHeaderName]: responseHeaderValue,
            location:
                "https://example.test/download?X-Amz-Credential=credential-secret&X-Amz-Signature=signature-secret&safe=1",
        });
        response.end(body);
    });
    t.after(() => closeServer(upstream.server));
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl: `${upstream.origin}/v1`,
    });

    const requestBody = '{"model":"test","input":"hello"}';
    try {
        const result = await request(
            new URL(
                "responses?api_key=request-secret&key=bare-secret&safe=value",
                `${proxy.proxyBaseUrl}/`,
            ),
            {
                method: "POST",
                headers: {
                    authorization: "Bearer top-secret",
                    "ocp-apim-subscription-key": "subscription-secret",
                    [sessionHeaderName]: sessionHeaderValue,
                    "content-type": "application/json",
                },
                body: requestBody,
            },
        );
        assert.equal(result.statusCode, 201);
        assert.equal(result.body.toString("utf8"), '{"ok":true}');
    } finally {
        await proxy.close();
    }

    assert.deepEqual(observed, {
        url: "/v1/responses?api_key=request-secret&key=bare-secret&safe=value",
        authorization: "Bearer top-secret",
        subscriptionKey: "subscription-secret",
        securityToken: sessionHeaderValue,
        body: requestBody,
    });
    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 2);
    const [requestRow, responseRow] = rows;
    assert.equal(requestRow.type, "request");
    assert.equal(
        requestRow.requestTarget,
        "/v1/responses?api_key=%5BREDACTED%5D&key=%5BREDACTED%5D&safe=value",
    );
    assert.equal(header(requestRow, "authorization"), "[REDACTED]");
    assert.equal(header(requestRow, "ocp-apim-subscription-key"), "[REDACTED]");
    assert.equal(header(requestRow, "x-amz-security-token"), "[REDACTED]");
    assert.equal(decodeBody(requestRow), requestBody);
    assert.equal(requestRow.complete, true);
    assert.equal(responseRow.type, "response");
    assert.equal(responseRow.statusCode, 201);
    assert.equal(header(responseRow, "x-api-key"), "[REDACTED]");
    assert.equal(
        header(responseRow, "location"),
        "https://example.test/download?X-Amz-Credential=%5BREDACTED%5D&X-Amz-Signature=%5BREDACTED%5D&safe=1",
    );
    assert.equal(decodeBody(responseRow), '{"ok":true}');
    assert.equal(responseRow.requestId, requestRow.requestId);
    assert.deepEqual(
        rows.map((row) => row.eventSequence),
        [1, 2],
    );
});

test("streams SSE immediately and records its exact bytes", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const emoji = Buffer.from("🙂");
    const first = Buffer.concat([Buffer.from("data: "), emoji.subarray(0, 2)]);
    const second = Buffer.concat([
        emoji.subarray(2),
        Buffer.from("\n\ndata: done\n\n"),
    ]);
    const expected = Buffer.concat([first, second]);
    let upstreamEnded = false;
    const upstream = await startServer((_request, response) => {
        response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
        });
        response.write(first);
        setTimeout(() => {
            upstreamEnded = true;
            response.end(second);
        }, 50);
    });
    t.after(() => closeServer(upstream.server));
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl: `${upstream.origin}/v1/`,
    });

    let firstChunkPrecededEnd = false;
    let result;
    try {
        result = await request(
            new URL("responses", proxy.proxyBaseUrl),
            {},
            () => {
                firstChunkPrecededEnd = !upstreamEnded;
            },
        );
    } finally {
        await proxy.close();
    }

    assert.equal(firstChunkPrecededEnd, true);
    assert.deepEqual(result.body, expected);
    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].type, "response");
    assert.deepEqual(Buffer.from(rows[1].body.base64, "base64"), expected);
});

test("serializes concurrent exchanges without torn JSONL rows", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const upstream = await startServer((request, response) => {
        const delay = request.url.includes("slow") ? 60 : 5;
        setTimeout(() => response.end(request.url), delay);
    });
    t.after(() => closeServer(upstream.server));
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl: `${upstream.origin}/v1`,
    });

    try {
        await Promise.all([
            request(new URL("slow", `${proxy.proxyBaseUrl}/`)),
            request(new URL("fast", `${proxy.proxyBaseUrl}/`)),
        ]);
    } finally {
        await proxy.close();
    }

    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 4);
    assert.deepEqual(
        rows.map((row) => row.eventSequence),
        [1, 2, 3, 4],
    );
    const requests = rows.filter((row) => row.type === "request");
    const terminals = rows.filter((row) => row.type !== "request");
    assert.equal(requests.length, 2);
    assert.equal(terminals.length, 2);
    assert.equal(new Set(requests.map((row) => row.requestId)).size, 2);
    for (const terminal of terminals) {
        const requestIndex = rows.findIndex(
            (row) =>
                row.type === "request" && row.requestId === terminal.requestId,
        );
        assert.ok(requestIndex >= 0);
        assert.ok(requestIndex < rows.indexOf(terminal));
    }
});

test("records HTTP failures as responses and socket resets as errors", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const upstream = await startServer((request, response) => {
        if (request.url.includes("http-error")) {
            response.writeHead(500, { "content-type": "text/plain" });
            response.end("upstream failed");
            return;
        }
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("partial");
        setTimeout(() => response.destroy(), 10);
    });
    t.after(() => closeServer(upstream.server));
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl: `${upstream.origin}/v1`,
    });

    try {
        const failure = await request(
            new URL("http-error", `${proxy.proxyBaseUrl}/`),
        );
        assert.equal(failure.statusCode, 500);
        await assert.rejects(
            request(new URL("reset", `${proxy.proxyBaseUrl}/`)),
        );
    } finally {
        await proxy.close();
    }

    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 4);
    const responseRow = rows.find(
        (row) => row.type === "response" && row.statusCode === 500,
    );
    assert.equal(decodeBody(responseRow), "upstream failed");
    const errorRow = rows.find((row) => row.type === "error");
    assert.equal(errorRow.phase, "upstream-response");
    assert.equal(errorRow.complete, false);
    assert.equal(decodeBody(errorRow.upstreamResponse), "partial");
    assert.equal(errorRow.upstreamResponse.body.complete, false);
});

test("records connection failures and returns a generated 502", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const unused = await startServer((_request, response) => response.end());
    const upstreamBaseUrl = `${unused.origin}/v1`;
    await closeServer(unused.server);
    const proxy = await startTraceProxy({ traceOutput, upstreamBaseUrl });

    try {
        const result = await request(
            new URL("responses", `${proxy.proxyBaseUrl}/`),
        );
        assert.equal(result.statusCode, 502);
        assert.equal(result.body.toString("utf8"), "Bad Gateway\n");
    } finally {
        await proxy.close();
    }

    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].type, "error");
    assert.equal(rows[1].phase, "upstream-request");
    assert.equal(rows[1].proxyResponse.statusCode, 502);
});

test("bounds shutdown when an upstream response never arrives", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    let markReceived;
    const received = new Promise((resolve) => {
        markReceived = resolve;
    });
    const upstream = await startServer(() => markReceived());
    t.after(() => closeServer(upstream.server));
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl: `${upstream.origin}/v1`,
        shutdownGraceMs: 50,
    });
    const pending = request(new URL("hang", `${proxy.proxyBaseUrl}/`));
    await received;

    const started = Date.now();
    const closing = proxy.close();
    await assert.rejects(pending);
    await closing;
    assert.ok(Date.now() - started < 1_000);

    const rows = await readTrace(traceOutput);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, "request");
    assert.equal(rows[1].type, "error");
    assert.equal(rows[1].complete, false);
});

test("ends the client and reports a trace append failure", async (t) => {
    const temporary = await temporaryDirectory(t);
    let closed = false;
    const proxy = await startTraceProxy({
        traceOutput: path.join(temporary, "unused.jsonl"),
        upstreamBaseUrl: "http://127.0.0.1:4627/v1",
        traceWriterFactory: async () => ({
            append: async () => {
                throw new Error("injected trace write failure");
            },
            close: async () => {
                closed = true;
            },
        }),
    });

    const result = await request(
        new URL("responses", `${proxy.proxyBaseUrl}/`),
    );
    assert.equal(result.statusCode, 500);
    await assert.rejects(proxy.close(), /injected trace write failure/);
    assert.equal(closed, true);
});

test("owns routing arguments and requires explicit wrapper inputs", () => {
    for (const variant of ["baseline", "typeagent", "typeagent-lsp"]) {
        assert.equal(
            parseWrapperArgs([
                "--trace-output",
                "trace.jsonl",
                "--upstream-base-url",
                "http://127.0.0.1:4627/v1",
                "--variant",
                variant,
                "--",
            ]).variant,
            variant,
        );
    }
    assert.throws(
        () =>
            parseWrapperArgs([
                "--trace-output",
                "trace.jsonl",
                "--upstream-base-url",
                "http://127.0.0.1:4627/v1",
                "--variant",
                "typeagent-mcp",
                "--",
            ]),
        /Unsupported benchmark variant/,
    );
    assert.throws(
        () =>
            parseWrapperArgs([
                "--trace-output",
                "trace.jsonl",
                "--upstream-base-url",
                "http://127.0.0.1:4627/v1",
                "--",
                "--variant=typeagent",
            ]),
        /wrapper owns --variant/,
    );
    assert.throws(
        () =>
            parseWrapperArgs([
                "--trace-output=trace.jsonl",
                "--upstream-base-url=http://127.0.0.1:4627/v1",
                "--",
                "--litellm-base-url",
                "http://other/v1",
            ]),
        /wrapper owns --litellm-base-url/,
    );
    assert.throws(
        () =>
            parseWrapperArgs([
                "--trace-output=trace.jsonl",
                "--upstream-base-url=http://127.0.0.1:4627/v1",
                "--",
                "--force-rerun",
            ]),
        /wrapper owns --force-rerun/,
    );
    assert.throws(
        () => parseWrapperArgs(["--trace-output", "trace.jsonl"]),
        /Separate wrapper options/,
    );
});

test("refuses to overwrite an existing trace", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    await writeFile(traceOutput, "existing\n");

    await assert.rejects(
        startTraceProxy({
            traceOutput,
            upstreamBaseUrl: "http://127.0.0.1:4627/v1",
        }),
        /EEXIST|file already exists/,
    );
    assert.equal(await readFile(traceOutput, "utf8"), "existing\n");
});

test("propagates a child failure after injecting the selected routing", async (t) => {
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const capture = path.join(temporary, "argv.json");
    const fixture = path.join(temporary, "fixture.mjs");
    await writeFile(
        fixture,
        `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(args[args.indexOf("--capture") + 1], JSON.stringify(args));
process.exitCode = 7;
`,
    );

    const result = await runBenchmarkWithTrace({
        traceOutput,
        upstreamBaseUrl: "http://127.0.0.1:4627/v1",
        variant: "typeagent-lsp",
        benchmarkArgs: ["--capture", capture],
        benchmarkCli: fixture,
        stdio: "ignore",
    });

    assert.deepEqual(result, { exitCode: 7, signal: null });
    const args = JSON.parse(await readFile(capture, "utf8"));
    assert.deepEqual(args.slice(0, 3), ["run", "--capture", capture]);
    assert.equal(args.filter((argument) => argument === "--variant").length, 1);
    assert.equal(args[args.indexOf("--variant") + 1], "typeagent-lsp");
    assert.equal(
        args.filter((argument) => argument === "--litellm-base-url").length,
        1,
    );
    assert.equal(
        args.filter((argument) => argument === "--force-rerun").length,
        1,
    );
    assert.equal(await readFile(traceOutput, "utf8"), "");
});

test("terminates the benchmark process group after a signal grace period", async (t) => {
    if (process.platform === "win32") {
        t.skip("POSIX process-group assertion");
        return;
    }
    const temporary = await temporaryDirectory(t);
    const traceOutput = path.join(temporary, "trace.jsonl");
    const pidsOutput = path.join(temporary, "pids.json");
    const resultOutput = path.join(temporary, "result.json");
    const benchmarkFixture = path.join(temporary, "benchmark.mjs");
    const runnerFixture = path.join(temporary, "runner.mjs");
    await writeFile(
        benchmarkFixture,
        `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const output = process.env.TRACE_TEST_PIDS;
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(output, JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
setInterval(() => {}, 1000);
`,
    );
    const moduleUrl = new URL("./run-mcp-with-http-trace.mjs", import.meta.url)
        .href;
    await writeFile(
        runnerFixture,
        `import { writeFileSync } from "node:fs";
import { runBenchmarkWithTrace } from ${JSON.stringify(moduleUrl)};
const result = await runBenchmarkWithTrace({
    traceOutput: ${JSON.stringify(traceOutput)},
    upstreamBaseUrl: "http://127.0.0.1:4627/v1",
    benchmarkArgs: [],
    benchmarkCli: ${JSON.stringify(benchmarkFixture)},
    stdio: "ignore",
    signalGraceMs: 50,
    proxyShutdownGraceMs: 50,
});
writeFileSync(${JSON.stringify(resultOutput)}, JSON.stringify(result));
`,
    );
    const runner = spawn(process.execPath, [runnerFixture], {
        env: { ...process.env, TRACE_TEST_PIDS: pidsOutput },
        stdio: "ignore",
    });
    const pids = JSON.parse(await waitForFile(pidsOutput));
    runner.kill("SIGTERM");
    const runnerResult = await waitForExit(runner);

    assert.deepEqual(runnerResult, { exitCode: 0, signal: null });
    assert.deepEqual(JSON.parse(await readFile(resultOutput, "utf8")), {
        exitCode: null,
        signal: "SIGTERM",
    });
    await waitUntil(() => !isProcessAlive(pids.child));
    await waitUntil(() => !isProcessAlive(pids.grandchild));
});

async function temporaryDirectory(t) {
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "typeagent-explore-trace-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

function startServer(handler) {
    const server = http.createServer((request, response) => {
        void Promise.resolve(handler(request, response)).catch((error) => {
            response.destroy(error);
        });
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            const address = server.address();
            resolve({
                server,
                origin: `http://127.0.0.1:${address.port}`,
            });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

function request(url, options = {}, onFirstChunk = () => {}) {
    return new Promise((resolve, reject) => {
        const outgoing = http.request(
            url,
            { method: options.method, headers: options.headers },
            (response) => {
                const chunks = [];
                let first = true;
                response.on("data", (chunk) => {
                    if (first) {
                        first = false;
                        onFirstChunk();
                    }
                    chunks.push(Buffer.from(chunk));
                });
                response.on("end", () =>
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: Buffer.concat(chunks),
                    }),
                );
                response.on("error", reject);
                response.on("aborted", () =>
                    reject(new Error("Response aborted")),
                );
            },
        );
        outgoing.on("error", reject);
        outgoing.end(options.body);
    });
}

async function readRequest(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function readTrace(output) {
    const text = await readFile(output, "utf8");
    return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function header(row, name) {
    return row.headers.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    )?.value;
}

function decodeBody(row) {
    return Buffer.from(row.body.base64, "base64").toString("utf8");
}

async function waitForFile(file) {
    let lastError;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            return await readFile(file, "utf8");
        } catch (error) {
            lastError = error;
            await delay(20);
        }
    }
    throw lastError;
}

function waitForExit(child) {
    return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
    });
}

async function waitUntil(predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) {
            return;
        }
        await delay(20);
    }
    assert.fail("condition did not become true before timeout");
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") {
            return false;
        }
        throw error;
    }
}
