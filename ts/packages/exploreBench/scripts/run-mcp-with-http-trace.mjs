#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import { access, mkdir, open } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const defaultBenchmarkCli = path.join(packageRoot, "dist", "src", "cli.js");
const benchmarkVariants = new Set(["baseline", "typeagent", "typeagent-lsp"]);
const ownedBenchmarkOptions = new Set([
    "variant",
    "litellm-base-url",
    "force-rerun",
]);
const hopByHopHeaders = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);
const credentialHeaderPattern =
    /(^|[-_])(authorization|cookie|api[-_]?key|subscription[-_]?key|(access|auth|security|session)[-_]?token|secret|credential)([-_]|$)/i;
const credentialQueryPattern =
    /(^|[-_])(api[-_]?key|key|(access|auth|security|session)[-_]?token|token|secret|credential|signature|sig|code)([-_]|$)/i;
const redacted = "[REDACTED]";

export function parseWrapperArgs(argv) {
    const options = new Map();
    let delimiter = -1;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === "--") {
            delimiter = index;
            break;
        }
        if (token === "--help" || token === "-h") {
            options.set("help", "true");
            continue;
        }
        if (!token.startsWith("--")) {
            throw new Error(`Unexpected wrapper argument: ${token}`);
        }
        const equals = token.indexOf("=");
        const name = token.slice(2, equals < 0 ? undefined : equals);
        if (
            name !== "trace-output" &&
            name !== "upstream-base-url" &&
            name !== "variant"
        ) {
            throw new Error(`Unknown wrapper option: --${name}`);
        }
        if (options.has(name)) {
            throw new Error(`--${name} may be specified only once`);
        }
        const value =
            equals >= 0
                ? token.slice(equals + 1)
                : argv[index + 1]?.startsWith("--")
                  ? undefined
                  : argv[++index];
        if (!value) {
            throw new Error(`Missing --${name}`);
        }
        options.set(name, value);
    }

    if (options.has("help")) {
        return { help: true, benchmarkArgs: [] };
    }
    if (delimiter < 0) {
        throw new Error(
            "Separate wrapper options from benchmark options with --",
        );
    }
    const benchmarkArgs = argv.slice(delimiter + 1);
    for (const token of benchmarkArgs) {
        if (!token.startsWith("--")) {
            continue;
        }
        const name = token.slice(2).split("=", 1)[0];
        if (ownedBenchmarkOptions.has(name)) {
            throw new Error(
                `The trace wrapper owns --${name}; remove it from the benchmark arguments`,
            );
        }
    }
    const traceOutput = options.get("trace-output");
    const upstreamBaseUrl = options.get("upstream-base-url");
    const variant = options.get("variant") ?? "typeagent";
    if (!traceOutput) {
        throw new Error("Missing --trace-output");
    }
    if (!upstreamBaseUrl) {
        throw new Error("Missing --upstream-base-url");
    }
    if (!benchmarkVariants.has(variant)) {
        throw new Error(
            `Unsupported benchmark variant ${JSON.stringify(variant)}; expected baseline, typeagent, or typeagent-lsp`,
        );
    }
    return {
        help: false,
        traceOutput: path.resolve(traceOutput),
        upstreamBaseUrl,
        variant,
        benchmarkArgs,
    };
}

class TraceWriter {
    static async create(output) {
        await mkdir(path.dirname(output), { recursive: true });
        const handle = await open(output, "wx", 0o600);
        return new TraceWriter(handle);
    }

    constructor(handle) {
        this.handle = handle;
        this.eventSequence = 0;
        this.tail = Promise.resolve();
        this.failure = undefined;
    }

    append(event) {
        const operation = this.tail.then(async () => {
            if (this.failure) {
                throw this.failure;
            }
            const row = {
                schemaVersion: 1,
                eventSequence: ++this.eventSequence,
                ...event,
            };
            await this.handle.write(`${JSON.stringify(row)}\n`);
        });
        this.tail = operation.catch((error) => {
            this.failure ??= error;
        });
        return operation;
    }

    async close() {
        await this.tail;
        try {
            if (this.failure) {
                throw this.failure;
            }
            await this.handle.sync();
        } finally {
            await this.handle.close();
        }
    }
}

export async function startTraceProxy({
    traceOutput,
    upstreamBaseUrl,
    shutdownGraceMs = 5_000,
    traceWriterFactory = (output) => TraceWriter.create(output),
}) {
    if (!Number.isFinite(shutdownGraceMs) || shutdownGraceMs < 1) {
        throw new Error("shutdownGraceMs must be a positive number");
    }
    const upstream = parseUpstreamBaseUrl(upstreamBaseUrl);
    const writer = await traceWriterFactory(path.resolve(traceOutput));
    const active = new Set();
    const sockets = new Set();
    let ingressSequence = 0;
    let closed = false;
    let exchangeFailure;

    const server = http.createServer((request, response) => {
        const exchange = proxyExchange({
            request,
            response,
            upstream,
            writer,
            ingressSequence: ++ingressSequence,
        });
        active.add(exchange);
        void exchange.then(
            () => active.delete(exchange),
            (error) => {
                exchangeFailure ??= error;
                active.delete(exchange);
                if (!response.headersSent && !response.destroyed) {
                    response.writeHead(500, { connection: "close" });
                    response.end();
                } else if (!response.destroyed) {
                    response.destroy();
                }
            },
        );
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    server.on("clientError", (_error, socket) => {
        if (socket.writable) {
            socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        }
    });

    try {
        await listenOnLoopback(server);
    } catch (error) {
        await writer.close();
        throw error;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
        await closeServer(server);
        await writer.close();
        throw new Error("Trace proxy did not receive a TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const proxyBaseUrl = new URL(
        `${upstream.pathname}${upstream.search}`,
        origin,
    ).toString();

    return {
        proxyBaseUrl,
        async close() {
            if (closed) {
                return;
            }
            closed = true;
            const stopped = closeServer(server);
            const graceful = Promise.allSettled([
                stopped,
                drainActive(active),
            ]).then(() => true);
            const completedGracefully = await Promise.race([
                graceful,
                delay(shutdownGraceMs, false, { ref: false }),
            ]);
            if (!completedGracefully) {
                for (const socket of sockets) {
                    socket.destroy(
                        new Error("Trace proxy shutdown grace period expired"),
                    );
                }
            }
            let closeFailure;
            try {
                await stopped;
                await drainActive(active);
            } catch (error) {
                closeFailure = error;
            }
            try {
                await writer.close();
            } catch (error) {
                closeFailure ??= error;
            }
            if (exchangeFailure || closeFailure) {
                throw exchangeFailure ?? closeFailure;
            }
        },
    };
}

async function proxyExchange({
    request,
    response,
    upstream,
    writer,
    ingressSequence,
}) {
    const requestId = `http-${String(ingressSequence).padStart(6, "0")}`;
    const startedAt = new Date();
    const started = process.hrtime.bigint();
    const requestChunks = [];
    let requestComplete = false;
    let requestBody;

    try {
        for await (const chunk of request) {
            requestChunks.push(Buffer.from(chunk));
        }
        requestComplete = true;
    } catch (error) {
        requestBody = Buffer.concat(requestChunks);
        await appendRequest();
        await writer.append(
            errorEvent({
                requestId,
                ingressSequence,
                started,
                phase: "client-request",
                error,
            }),
        );
        if (!response.headersSent && !response.destroyed) {
            response.writeHead(400, { connection: "close" });
            response.end();
        }
        return;
    }

    requestBody = Buffer.concat(requestChunks);
    await appendRequest();
    const incoming = new URL(request.url ?? "/", "http://proxy.invalid");
    const target = new URL(
        `${incoming.pathname}${incoming.search}`,
        upstream.origin,
    );
    const transport = target.protocol === "https:" ? https : http;

    await new Promise((resolve, reject) => {
        let terminal = false;
        let upstreamResponse;
        const responseChunks = [];

        const settle = async (event) => {
            if (terminal) {
                return;
            }
            terminal = true;
            try {
                await writer.append(event);
                resolve();
            } catch (error) {
                reject(error);
            }
        };

        const upstreamRequest = transport.request(
            {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || undefined,
                method: request.method,
                path: `${target.pathname}${target.search}`,
                headers: requestHeadersForUpstream(
                    request.headers,
                    target,
                    requestBody,
                ),
            },
            (received) => {
                upstreamResponse = received;
                const responseHeaders = responseHeadersForClient(
                    received.headers,
                );
                if (!response.destroyed) {
                    if (received.statusMessage) {
                        response.writeHead(
                            received.statusCode ?? 502,
                            received.statusMessage,
                            responseHeaders,
                        );
                    } else {
                        response.writeHead(
                            received.statusCode ?? 502,
                            responseHeaders,
                        );
                    }
                }
                received.on("data", (chunk) => {
                    const bytes = Buffer.from(chunk);
                    responseChunks.push(bytes);
                    if (!response.destroyed) {
                        if (!response.write(bytes)) {
                            received.pause();
                            response.once("drain", () => received.resume());
                        }
                    }
                });
                received.on("end", () => {
                    if (!response.destroyed) {
                        response.end();
                    }
                    void settle({
                        type: "response",
                        requestId,
                        ingressSequence,
                        timestamp: new Date().toISOString(),
                        durationMs: elapsedMilliseconds(started),
                        statusCode: received.statusCode ?? 0,
                        statusMessage: received.statusMessage ?? "",
                        httpVersion: received.httpVersion,
                        headers: traceHeaders(received.rawHeaders),
                        body: traceBody(Buffer.concat(responseChunks), true),
                        complete: true,
                    });
                });
                received.on("aborted", () => {
                    void settle(
                        errorEvent({
                            requestId,
                            ingressSequence,
                            started,
                            phase: "upstream-response",
                            error: new Error("Upstream response was aborted"),
                            upstreamResponse: received,
                            responseBody: Buffer.concat(responseChunks),
                        }),
                    );
                    if (!response.destroyed) {
                        response.destroy();
                    }
                });
                received.on("error", (error) => {
                    void settle(
                        errorEvent({
                            requestId,
                            ingressSequence,
                            started,
                            phase: "upstream-response",
                            error,
                            upstreamResponse: received,
                            responseBody: Buffer.concat(responseChunks),
                        }),
                    );
                    if (!response.destroyed) {
                        response.destroy();
                    }
                });
                received.on("close", () => {
                    if (!received.complete) {
                        void settle(
                            errorEvent({
                                requestId,
                                ingressSequence,
                                started,
                                phase: "upstream-response",
                                error: new Error(
                                    "Upstream response closed before completion",
                                ),
                                upstreamResponse: received,
                                responseBody: Buffer.concat(responseChunks),
                            }),
                        );
                        if (!response.destroyed) {
                            response.destroy();
                        }
                    }
                });
            },
        );

        upstreamRequest.on("error", (error) => {
            let proxyResponse;
            if (!response.headersSent && !response.destroyed) {
                const bytes = Buffer.from("Bad Gateway\n");
                proxyResponse = {
                    statusCode: 502,
                    headers: [{ name: "content-type", value: "text/plain" }],
                    body: traceBody(bytes, true),
                };
                response.writeHead(502, {
                    "content-type": "text/plain",
                    "content-length": String(bytes.length),
                    connection: "close",
                });
                response.end(bytes);
            }
            void settle(
                errorEvent({
                    requestId,
                    ingressSequence,
                    started,
                    phase: upstreamResponse
                        ? "upstream-response"
                        : "upstream-request",
                    error,
                    upstreamResponse,
                    responseBody: Buffer.concat(responseChunks),
                    proxyResponse,
                }),
            );
        });
        response.on("close", () => {
            if (!terminal && !response.writableEnded) {
                upstreamRequest.destroy();
                void settle(
                    errorEvent({
                        requestId,
                        ingressSequence,
                        started,
                        phase: "client-response",
                        error: new Error(
                            "Client disconnected before the response completed",
                        ),
                        upstreamResponse,
                        responseBody: Buffer.concat(responseChunks),
                    }),
                );
            }
        });
        upstreamRequest.end(requestBody);
    });

    async function appendRequest() {
        const incoming = new URL(request.url ?? "/", "http://proxy.invalid");
        const target = new URL(
            `${incoming.pathname}${incoming.search}`,
            upstream.origin,
        );
        const sanitizedUrl = sanitizeUrl(target);
        await writer.append({
            type: "request",
            requestId,
            ingressSequence,
            timestamp: startedAt.toISOString(),
            method: request.method ?? "GET",
            url: sanitizedUrl.toString(),
            requestTarget: `${sanitizedUrl.pathname}${sanitizedUrl.search}`,
            httpVersion: request.httpVersion,
            headers: traceHeaders(request.rawHeaders),
            body: traceBody(requestBody ?? Buffer.alloc(0), requestComplete),
            complete: requestComplete,
        });
    }
}

function errorEvent({
    requestId,
    ingressSequence,
    started,
    phase,
    error,
    upstreamResponse,
    responseBody,
    proxyResponse,
}) {
    return {
        type: "error",
        requestId,
        ingressSequence,
        timestamp: new Date().toISOString(),
        durationMs: elapsedMilliseconds(started),
        phase,
        error: serializeError(error),
        ...(upstreamResponse
            ? {
                  upstreamResponse: {
                      statusCode: upstreamResponse.statusCode ?? 0,
                      statusMessage: upstreamResponse.statusMessage ?? "",
                      httpVersion: upstreamResponse.httpVersion,
                      headers: traceHeaders(upstreamResponse.rawHeaders),
                      body: traceBody(responseBody ?? Buffer.alloc(0), false),
                      complete: false,
                  },
              }
            : {}),
        ...(proxyResponse ? { proxyResponse } : {}),
        complete: false,
    };
}

function requestHeadersForUpstream(headers, target, body) {
    const result = {};
    for (const [name, value] of Object.entries(headers)) {
        const lower = name.toLowerCase();
        if (
            value !== undefined &&
            lower !== "host" &&
            lower !== "content-length" &&
            !hopByHopHeaders.has(lower)
        ) {
            result[name] = value;
        }
    }
    result.host = target.host;
    if (body.length > 0 || headers["content-length"] !== undefined) {
        result["content-length"] = String(body.length);
    }
    return result;
}

function responseHeadersForClient(headers) {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) =>
                value !== undefined && !hopByHopHeaders.has(name.toLowerCase()),
        ),
    );
}

function traceHeaders(rawHeaders) {
    const result = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
        const name = rawHeaders[index];
        result.push({
            name,
            value: traceHeaderValue(name, rawHeaders[index + 1]),
        });
    }
    return result;
}

function traceHeaderValue(name, value) {
    if (credentialHeaderPattern.test(name)) {
        return redacted;
    }
    const lower = name.toLowerCase();
    if (lower !== "location" && lower !== "content-location") {
        return value;
    }
    try {
        return sanitizeUrl(new URL(value)).toString();
    } catch {
        const sanitized = sanitizeUrl(
            new URL(value, "http://relative-location.invalid"),
        );
        return `${sanitized.pathname}${sanitized.search}${sanitized.hash}`;
    }
}

function traceBody(body, complete) {
    return {
        byteLength: body.length,
        base64: body.toString("base64"),
        utf8: body.toString("utf8"),
        complete,
    };
}

function sanitizeUrl(url) {
    const sanitized = new URL(url);
    if (sanitized.username) {
        sanitized.username = redacted;
    }
    if (sanitized.password) {
        sanitized["password"] = redacted;
    }
    for (const name of new Set(sanitized.searchParams.keys())) {
        if (credentialQueryPattern.test(name)) {
            sanitized.searchParams.set(name, redacted);
        }
    }
    return sanitized;
}

function serializeError(error) {
    const normalized =
        error instanceof Error ? error : new Error(String(error));
    return {
        name: normalized.name,
        message: normalized.message,
        ...(typeof normalized.code === "string"
            ? { code: normalized.code }
            : {}),
    };
}

function parseUpstreamBaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("--upstream-base-url must use http or https");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(
            "--upstream-base-url must not contain credentials, a query, or a fragment",
        );
    }
    return url;
}

function elapsedMilliseconds(started) {
    return Number(
        (Number(process.hrtime.bigint() - started) / 1_000_000).toFixed(3),
    );
}

function listenOnLoopback(server) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(0, "127.0.0.1");
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function drainActive(active) {
    while (active.size > 0) {
        await Promise.allSettled([...active]);
    }
}

export async function runBenchmarkWithTrace({
    traceOutput,
    upstreamBaseUrl,
    variant = "typeagent",
    benchmarkArgs,
    benchmarkCli = defaultBenchmarkCli,
    stdio = "inherit",
    signalGraceMs = 5_000,
    proxyShutdownGraceMs = 5_000,
}) {
    await access(benchmarkCli).catch(() => {
        throw new Error(
            `Built benchmark CLI not found at ${benchmarkCli}; build @typeagent/explore-bench first`,
        );
    });
    const proxy = await startTraceProxy({
        traceOutput,
        upstreamBaseUrl,
        shutdownGraceMs: proxyShutdownGraceMs,
    });
    let child;
    const signalHandlers = new Map();
    let forwardedSignal;
    let escalationTimer;
    let resolveEscalation;
    let escalation = Promise.resolve();
    try {
        child = spawn(
            process.execPath,
            [
                benchmarkCli,
                "run",
                ...benchmarkArgs,
                "--variant",
                variant,
                "--litellm-base-url",
                proxy.proxyBaseUrl,
                "--force-rerun",
            ],
            { stdio, detached: process.platform !== "win32" },
        );
        for (const signal of ["SIGINT", "SIGTERM"]) {
            const handler = () => {
                if (forwardedSignal) {
                    signalChildTree(child, "SIGKILL");
                    finishEscalation();
                    return;
                }
                forwardedSignal = signal;
                signalChildTree(child, signal);
                escalation = new Promise((resolve) => {
                    resolveEscalation = resolve;
                });
                escalationTimer = setTimeout(() => {
                    signalChildTree(child, "SIGKILL");
                    finishEscalation();
                }, signalGraceMs);
                escalationTimer.unref();
            };
            signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }
        const result = await waitForChild(child);
        if (forwardedSignal) {
            if (!isChildTreeAlive(child)) {
                finishEscalation();
            }
            await escalation;
        }
        return result;
    } finally {
        for (const [signal, handler] of signalHandlers) {
            process.off(signal, handler);
        }
        await proxy.close();
    }

    function finishEscalation() {
        if (escalationTimer) {
            clearTimeout(escalationTimer);
            escalationTimer = undefined;
        }
        resolveEscalation?.();
        resolveEscalation = undefined;
    }
}

function signalChildTree(child, signal) {
    if (!child.pid) {
        return;
    }
    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, signal);
            return;
        } catch (error) {
            if (error.code === "ESRCH") {
                return;
            }
        }
    }
    try {
        child.kill(signal);
    } catch (error) {
        if (error.code !== "ESRCH") {
            throw error;
        }
    }
}

function isChildTreeAlive(child) {
    if (!child.pid) {
        return false;
    }
    if (process.platform === "win32") {
        return child.exitCode === null && child.signalCode === null;
    }
    try {
        process.kill(-child.pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") {
            return false;
        }
        return true;
    }
}

function waitForChild(child) {
    return new Promise((resolve, reject) => {
        let settled = false;
        child.once("error", (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
        child.once("exit", (exitCode, signal) => {
            if (!settled) {
                settled = true;
                resolve({ exitCode, signal });
            }
        });
    });
}

const helpText = `run-mcp-with-http-trace

Run one benchmark arm through a loopback recording proxy.

Usage:
  node scripts/run-mcp-with-http-trace.mjs \\
    --trace-output <trace.jsonl> \\
    --upstream-base-url <http-or-https-url> \\
    [--variant <baseline|typeagent|typeagent-lsp>] \\
    -- <normal benchmark run options>

The wrapper defaults to --variant typeagent, forces --force-rerun, and supplies
--litellm-base-url. Do not pass those options after --. The output file is
created exclusively and will not overwrite an existing trace.

The trace redacts credential headers and sensitive URL parameters, but records
full prompt and response bodies. Treat it as sensitive data.
`;

async function main(argv) {
    const options = parseWrapperArgs(argv);
    if (options.help) {
        process.stdout.write(helpText);
        return;
    }
    const result = await runBenchmarkWithTrace(options);
    process.stdout.write(`trace=${options.traceOutput}\n`);
    if (result.signal) {
        process.kill(process.pid, result.signal);
        return;
    }
    process.exitCode = result.exitCode ?? 1;
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    await main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`error: ${error.message}\n`);
        process.exitCode = 1;
    });
}
