// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    attachTelemetryErrorClassification,
    classifyTelemetryError,
    classifyTelemetryErrorIfRecognized,
    classifyTelemetryHttpStatus,
    isTelemetryCancellation,
    readTelemetryErrorClassification,
    TELEMETRY_ERROR_CODES,
    type TelemetryErrorClassification,
} from "../src/otel/errorClassification.js";

// `Error`'s `cause` option is ES2022; the repo compiles against ES2021 libs,
// so the tests attach `cause` (and the other structured properties they
// exercise) explicitly.
function errorWith<T extends object>(
    message: string,
    properties: T,
): Error & T {
    return Object.assign(new Error(message), properties);
}

/** An object whose every property read throws, as a hostile error would. */
function hostileObject(): object {
    return new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(`no reads allowed: ${String(property)}`);
            },
            has() {
                throw new Error("no `in` allowed");
            },
            ownKeys() {
                throw new Error("no enumeration allowed");
            },
        },
    );
}

describe("classifyTelemetryError", () => {
    describe("typed and named errors", () => {
        it("maps standard platform error names", () => {
            expect(
                classifyTelemetryError(
                    new DOMException(
                        "The operation was aborted.",
                        "AbortError",
                    ),
                ),
            ).toEqual({ errorCategory: "cancelled", retryable: false });

            const timeout = new Error("private endpoint detail");
            timeout.name = "TimeoutError";
            expect(classifyTelemetryError(timeout)).toEqual({
                errorCategory: "timeout",
                retryable: true,
            });

            const undici = new Error("private endpoint detail");
            undici.name = "ConnectTimeoutError";
            expect(classifyTelemetryError(undici)).toEqual({
                errorCategory: "timeout",
                retryable: true,
            });
        });

        it("leaves an unrecognized name unclassified", () => {
            const error = new Error("private message");
            error.name = "SomeAgentSpecificError";
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "internal",
            });
        });

        it("honors an explicit classification attached by the thrower", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        errorCategory: "provider",
                        retryable: false,
                    }),
                ),
            ).toEqual({ errorCategory: "provider", retryable: false });
        });

        it("honors an explicit code from the reviewed allowlist", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        errorCategory: "validation",
                        errorCode: "ERR_INVALID_URL",
                    }),
                ),
            ).toEqual({
                errorCategory: "validation",
                errorCode: "ERR_INVALID_URL",
            });
        });

        it("ignores an explicit category outside the closed union", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        errorCategory: "catastrophe",
                        retryable: true,
                    }),
                ),
            ).toEqual({ errorCategory: "internal" });
        });

        it("omits retryable when the thrower did not state it", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        errorCategory: "validation",
                    }),
                ),
            ).toEqual({ errorCategory: "validation" });
        });
    });

    describe("codes", () => {
        const codeCases: readonly [string, string, boolean][] = [
            ["ECONNREFUSED", "network", true],
            ["EAI_AGAIN", "network", true],
            ["ETIMEDOUT", "timeout", true],
            ["UND_ERR_HEADERS_TIMEOUT", "timeout", true],
            ["ABORT_ERR", "cancelled", false],
            ["CERT_HAS_EXPIRED", "network", false],
        ];

        it("maps standard platform codes", () => {
            for (const [code, errorCategory, retryable] of codeCases) {
                expect(
                    classifyTelemetryError(
                        errorWith("private message", { code }),
                    ),
                ).toEqual({ errorCategory, errorCode: code, retryable });
            }
        });

        it("reports an allowlisted code that implies no category", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", { code: "ENOENT" }),
                ),
            ).toEqual({ errorCategory: "internal", errorCode: "ENOENT" });
        });
    });

    describe("HTTP status", () => {
        const statusCases: readonly [number, string, boolean][] = [
            [400, "validation", false],
            [401, "authentication", false],
            [403, "authorization", false],
            [404, "validation", false],
            [408, "timeout", true],
            [422, "validation", false],
            [429, "rate_limit", true],
            [500, "provider", true],
            [503, "provider", true],
            [504, "timeout", true],
        ];

        it("maps status codes to categories and retryability", () => {
            for (const [status, errorCategory, retryable] of statusCases) {
                expect(
                    classifyTelemetryError(
                        errorWith("private message", { status }),
                    ),
                ).toEqual({ errorCategory, httpStatus: status, retryable });
            }
        });

        it("classifies a bare status the same way", () => {
            for (const [status, errorCategory, retryable] of statusCases) {
                expect(classifyTelemetryHttpStatus(status)).toEqual({
                    errorCategory,
                    httpStatus: status,
                    retryable,
                });
            }
        });

        it("reports nothing for a status that is not a failure", () => {
            for (const status of [0, 100, 200, 304, 143, 600, 429.5]) {
                expect(classifyTelemetryHttpStatus(status)).toBeUndefined();
            }
        });

        it("reads the status off a response object", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        response: { status: 429 },
                    }),
                ),
            ).toEqual({
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            });
        });

        it("never coerces a non-numeric or non-failure status", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", { status: "429" }),
                ),
            ).toEqual({ errorCategory: "internal" });
            expect(
                classifyTelemetryError(
                    errorWith("private message", { statusCode: 42 }),
                ),
            ).toEqual({ errorCategory: "internal" });
            // 1xx/2xx/3xx say nothing about a failure, and `status` is used as
            // a non-HTTP enum elsewhere (a child_process exit code, say).
            for (const status of [100, 200, 304, 143]) {
                expect(
                    classifyTelemetryError(
                        errorWith("private message", { status }),
                    ),
                ).toEqual({ errorCategory: "internal" });
            }
        });

        it("does not let a non-failure status hide the real signal", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        status: 200,
                        cause: errorWith("inner", { code: "ECONNREFUSED" }),
                    }),
                ),
            ).toEqual({
                errorCategory: "network",
                errorCode: "ECONNREFUSED",
                retryable: true,
            });
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        status: 143,
                        cause: new DOMException(
                            "The operation was aborted.",
                            "AbortError",
                        ),
                    }),
                ),
            ).toEqual({ errorCategory: "cancelled", retryable: false });
        });
    });

    // The reported fields must describe one error, not a mixture: a cause's
    // code next to its wrapper's HTTP status would read as a coherent failure
    // that never happened.
    describe("precedence", () => {
        it("prefers a code over a status carried on the same error", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        code: "ECONNRESET",
                        status: 500,
                    }),
                ),
            ).toEqual({
                errorCategory: "network",
                errorCode: "ECONNRESET",
                httpStatus: 500,
                retryable: true,
            });
        });

        it("prefers a name over a code carried on the same error", () => {
            const error = errorWith("private message", { code: "ECONNRESET" });
            error.name = "TimeoutError";
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "timeout",
                errorCode: "ECONNRESET",
                retryable: true,
            });
        });

        it("prefers the thrower's classification over every platform signal", () => {
            const error = errorWith("private message", {
                errorCategory: "authorization",
                retryable: false,
                code: "ECONNRESET",
                status: 500,
            });
            error.name = "TimeoutError";
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "authorization",
                errorCode: "ECONNRESET",
                httpStatus: 500,
                retryable: false,
            });
        });

        it("never mixes fields from different links of the chain", () => {
            // The wrapper's 401 wins, so the cause's ECONNRESET is not
            // reported alongside it: the two describe different failures.
            expect(
                classifyTelemetryError(
                    errorWith("private message", {
                        status: 401,
                        cause: errorWith("inner", { code: "ECONNRESET" }),
                    }),
                ),
            ).toEqual({
                errorCategory: "authentication",
                httpStatus: 401,
                retryable: false,
            });
        });

        it("takes every field from the first link that carries a signal", () => {
            expect(
                classifyTelemetryError(
                    errorWith("outer with nothing to say", {
                        cause: errorWith("inner", {
                            code: "ECONNRESET",
                            status: 503,
                        }),
                    }),
                ),
            ).toEqual({
                errorCategory: "network",
                errorCode: "ECONNRESET",
                httpStatus: 503,
                retryable: true,
            });
        });
    });

    // A code becomes a log/metric label. Only reviewed constants may leave the
    // process, so an identifier-shaped value cannot ride out as one.
    describe("error code bounds", () => {
        it("drops every code outside the reviewed allowlist", () => {
            const rejected = [
                "rate limit exceeded for user bob@example.com",
                "550e8400-e29b-41d4-a716-446655440000",
                "550E8400E29B41D4A716446655440000",
                "user_3f8a2b1c",
                "bob@example.com",
                "sk-ABCDEF0123456789",
                "AKIAIOSFODNN7EXAMPLE",
                "ERR_BAD_REQUEST",
                "E_CUSTOM_AGENT_FAILURE",
                "429",
                "",
                "a".repeat(65),
                "  ETIMEDOUT",
                "etimedout",
            ];
            for (const code of rejected) {
                expect(
                    classifyTelemetryError(
                        errorWith("private message", { code }),
                    ).errorCode,
                ).toBeUndefined();
                expect(
                    classifyTelemetryError(
                        errorWith("private message", {
                            errorCategory: "provider",
                            errorCode: code,
                        }),
                    ).errorCode,
                ).toBeUndefined();
            }
        });

        it("ignores a numeric code such as the legacy DOMException code", () => {
            expect(
                classifyTelemetryError(
                    errorWith("private message", { code: 20 }),
                ),
            ).toEqual({ errorCategory: "internal" });
        });

        it("keeps the allowlist small and shaped like an enum", () => {
            // The bound is the point: a code is a label dimension, so the
            // whole vocabulary has to stay reviewable and low-cardinality.
            expect(TELEMETRY_ERROR_CODES.length).toBeLessThanOrEqual(64);
            expect(new Set(TELEMETRY_ERROR_CODES).size).toBe(
                TELEMETRY_ERROR_CODES.length,
            );
            for (const code of TELEMETRY_ERROR_CODES) {
                expect(code).toMatch(/^[A-Z][A-Z0-9_]{1,39}$/);
            }
        });
    });

    describe("cause traversal", () => {
        it("classifies from the cause when the wrapper says nothing", () => {
            const error = errorWith("fetch failed", {
                cause: errorWith("private message", {
                    code: "ECONNREFUSED",
                }),
            });
            error.name = "TypeError";
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "network",
                errorCode: "ECONNREFUSED",
                retryable: true,
            });
        });

        it("follows the first error of an AggregateError", () => {
            expect(
                classifyTelemetryError(
                    new AggregateError(
                        [
                            errorWith("private message", { status: 429 }),
                            new Error("second"),
                        ],
                        "all failed",
                    ),
                ),
            ).toEqual({
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            });
        });

        it("terminates on a self-referential cause", () => {
            const error = new Error("private message") as unknown as Record<
                string,
                unknown
            >;
            error.cause = error;
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "internal",
            });
        });

        it("terminates on a mutually-referential cause cycle", () => {
            const first = new Error("first") as unknown as Record<
                string,
                unknown
            >;
            const second = errorWith("second", {
                code: "ECONNRESET",
            }) as unknown as Record<string, unknown>;
            first.cause = second;
            second.cause = first;
            expect(classifyTelemetryError(first)).toEqual({
                errorCategory: "network",
                errorCode: "ECONNRESET",
                retryable: true,
            });
        });

        it("stops walking a chain longer than the depth bound", () => {
            // The only signal sits past the bound, so it is never reached: the
            // classification stays honest rather than paying unbounded cost.
            let error: Error = errorWith("deep", { code: "ECONNREFUSED" });
            for (let index = 0; index < 20; index++) {
                error = errorWith(`wrapper ${index}`, { cause: error });
            }
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "internal",
            });
        });
    });

    // Classification runs on a value the process did not construct, so every
    // read has to survive a getter that throws or a proxy that traps.
    describe("hostile values", () => {
        it("survives an error whose every property read throws", () => {
            expect(classifyTelemetryError(hostileObject())).toEqual({
                errorCategory: "internal",
            });
        });

        it("survives a throwing getter on each classification input", () => {
            const throwing = ["name", "code", "errorCategory", "errorCode"];
            for (const property of throwing) {
                const error = new Error("private message");
                Object.defineProperty(error, property, {
                    get() {
                        throw new Error(`${property} is hostile`);
                    },
                    configurable: true,
                });
                expect(classifyTelemetryError(error)).toEqual({
                    errorCategory: "internal",
                });
            }
        });

        it("survives throwing status, response, retryable, and cause getters", () => {
            const error = errorWith("private message", {
                code: "ECONNRESET",
                errorCategory: "provider",
            });
            for (const property of [
                "status",
                "statusCode",
                "httpStatus",
                "response",
                "retryable",
                "cause",
                "errors",
            ]) {
                Object.defineProperty(error, property, {
                    get() {
                        throw new Error(`${property} is hostile`);
                    },
                    configurable: true,
                });
            }
            expect(classifyTelemetryError(error)).toEqual({
                errorCategory: "provider",
                errorCode: "ECONNRESET",
            });
        });

        it("survives a hostile value in the cause chain", () => {
            expect(
                classifyTelemetryError(
                    errorWith("outer", { cause: hostileObject() }),
                ),
            ).toEqual({ errorCategory: "internal" });
            expect(
                classifyTelemetryError(
                    errorWith("outer", {
                        cause: errorWith("middle", {
                            cause: hostileObject(),
                        }),
                    }),
                ),
            ).toEqual({ errorCategory: "internal" });
        });

        it("survives a revoked proxy", () => {
            const revocable = Proxy.revocable(
                errorWith("private message", { code: "ECONNRESET" }),
                {},
            );
            revocable.revoke();
            expect(classifyTelemetryError(revocable.proxy)).toEqual({
                errorCategory: "internal",
            });
            expect(
                classifyTelemetryError(
                    errorWith("outer", { cause: revocable.proxy }),
                ),
            ).toEqual({ errorCategory: "internal" });
        });

        it("survives an AggregateError whose errors array traps reads", () => {
            const errors = new Proxy([new Error("inner")], {
                get(target, property) {
                    if (property === "0") {
                        throw new Error("index read is hostile");
                    }
                    return Reflect.get(target, property);
                },
            });
            expect(
                classifyTelemetryError(errorWith("aggregate", { errors })),
            ).toEqual({ errorCategory: "internal" });
        });

        it("keeps a link it already classified when the walk cannot continue", () => {
            // `Array.isArray` throws on a revoked proxy rather than returning
            // false, so an unreadable `errors` must end the walk without
            // discarding the outer link that already carried the signal.
            const revocable = Proxy.revocable([new Error("inner")], {});
            revocable.revoke();
            const cancelled = errorWith("aborted by user", {
                errors: revocable.proxy,
            });
            cancelled.name = "AbortError";
            expect(classifyTelemetryError(cancelled)).toEqual({
                errorCategory: "cancelled",
                retryable: false,
            });

            const throttled = errorWith("throttled", {
                status: 429,
                errors: revocable.proxy,
            });
            expect(classifyTelemetryError(throttled)).toEqual({
                errorCategory: "rate_limit",
                httpStatus: 429,
                retryable: true,
            });
        });

        it("survives an AggregateError carrying a hostile first entry", () => {
            expect(
                classifyTelemetryError(
                    errorWith("aggregate", { errors: [hostileObject()] }),
                ),
            ).toEqual({ errorCategory: "internal" });
        });
    });

    describe("unknown throws", () => {
        const unknownThrows: readonly unknown[] = [
            "boom: user said hello",
            undefined,
            null,
            42,
            { message: "user said hello" },
            new Error("user said hello"),
            Object.create(null),
        ];

        it("classifies unknown throws as internal without inventing fields", () => {
            for (const value of unknownThrows) {
                const classification: TelemetryErrorClassification =
                    classifyTelemetryError(value);
                expect(classification).toEqual({ errorCategory: "internal" });
            }
        });

        it("never returns the original message or stack", () => {
            const classification = classifyTelemetryError(
                new Error("secret user request text"),
            );
            expect(Object.keys(classification)).toEqual(["errorCategory"]);
            expect(JSON.stringify(classification)).not.toContain("secret");
        });
    });
});

// The difference between "we recognized nothing" and "this was internal".
// A caller that attaches a classification to a value with its own truthful
// default needs the first; a caller that must report a category needs the
// second.
describe("classifyTelemetryErrorIfRecognized", () => {
    it("reports nothing for a value carrying no recognized signal", () => {
        for (const value of [
            "boom: user said hello",
            undefined,
            null,
            42,
            { message: "user said hello" },
            new Error("user said hello"),
            new TypeError("fetch failed"),
            hostileObject(),
        ]) {
            expect(classifyTelemetryErrorIfRecognized(value)).toBeUndefined();
            // The same value still classifies as `internal` where a category
            // is required.
            expect(classifyTelemetryError(value)).toEqual({
                errorCategory: "internal",
            });
        }
    });

    it("agrees with classifyTelemetryError whenever anything was recognized", () => {
        const recognized: readonly unknown[] = [
            new DOMException("The operation was aborted.", "AbortError"),
            errorWith("private endpoint detail", { code: "ECONNREFUSED" }),
            errorWith("throttled", { status: 429 }),
            errorWith("fetch failed", {
                cause: errorWith("connect", { code: "ECONNRESET" }),
            }),
            errorWith("typed", { errorCategory: "provider", retryable: false }),
        ];
        for (const value of recognized) {
            const classification = classifyTelemetryErrorIfRecognized(value);
            expect(classification).toBeDefined();
            expect(classification).toEqual(classifyTelemetryError(value));
        }
    });

    it("reports an allowlisted code with no category rule as internal, not as unrecognized", () => {
        // A reviewed code is a signal even when it says nothing about the
        // category, so it is reported rather than dropped.
        const enoent = errorWith("private path detail", { code: "ENOENT" });
        expect(classifyTelemetryErrorIfRecognized(enoent)).toEqual({
            errorCategory: "internal",
            errorCode: "ENOENT",
        });
    });
});

// One cancellation test for spans, structured events, and the LLM wrapper, so
// a span status and the log record beside it cannot disagree.
describe("isTelemetryCancellation", () => {
    it("recognizes a cancellation wrapped inside a phase-level error", () => {
        const wrapped = errorWith("translation failed", {
            cause: new DOMException("The operation was aborted.", "AbortError"),
        });
        // What a call site comparing `error.name` would have seen.
        expect(wrapped.name).toBe("Error");
        expect(isTelemetryCancellation(wrapped)).toBe(true);
    });

    it("honors a hint the thrown value cannot carry", () => {
        // Signal-only: the work was torn down, and what surfaced is whatever
        // the provider was in the middle of.
        expect(isTelemetryCancellation(new Error("socket hang up"), true)).toBe(
            true,
        );
        expect(isTelemetryCancellation(undefined, true)).toBe(true);
    });

    it("does not treat an ordinary failure as cancelled", () => {
        expect(isTelemetryCancellation(new Error("boom"))).toBe(false);
        expect(isTelemetryCancellation(new Error("boom"), false)).toBe(false);
        expect(
            isTelemetryCancellation(errorWith("throttled", { status: 429 })),
        ).toBe(false);
        expect(isTelemetryCancellation(undefined)).toBe(false);
    });

    it("never throws on a hostile value", () => {
        expect(isTelemetryCancellation(hostileObject())).toBe(false);
    });
});

describe("classification carrier", () => {
    it("round-trips a classification through a failure result", () => {
        const result = attachTelemetryErrorClassification(
            { success: false as const, message: "429: secret tenant detail" },
            { errorCategory: "rate_limit", httpStatus: 429, retryable: true },
        );
        expect(readTelemetryErrorClassification(result)).toEqual({
            errorCategory: "rate_limit",
            httpStatus: 429,
            retryable: true,
        });
    });

    it("stays invisible to existing consumers of the result", () => {
        const result = attachTelemetryErrorClassification(
            { success: false as const, message: "failed" },
            { errorCategory: "network", retryable: true },
        );
        expect(result).toEqual({ success: false, message: "failed" });
        expect(Object.keys(result)).toEqual(["success", "message"]);
        expect(JSON.parse(JSON.stringify(result))).toEqual({
            success: false,
            message: "failed",
        });
    });

    it("reports nothing for a value that carries no classification", () => {
        for (const value of [
            undefined,
            null,
            "failed",
            { success: false, message: "failed" },
        ]) {
            expect(readTelemetryErrorClassification(value)).toBeUndefined();
        }
    });

    it("re-validates the carrier against the same closed vocabularies", () => {
        const forged = attachTelemetryErrorClassification({}, {
            errorCategory: "catastrophe",
        } as unknown as TelemetryErrorClassification);
        expect(readTelemetryErrorClassification(forged)).toBeUndefined();

        const partlyForged = attachTelemetryErrorClassification({}, {
            errorCategory: "provider",
            errorCode: "tenant-8f14e45f",
            httpStatus: 200,
            retryable: "yes",
        } as unknown as TelemetryErrorClassification);
        expect(readTelemetryErrorClassification(partlyForged)).toEqual({
            errorCategory: "provider",
        });
    });

    it("never throws on a frozen target or a hostile read", () => {
        const frozen = Object.freeze({ success: false as const, message: "x" });
        expect(() =>
            attachTelemetryErrorClassification(frozen, {
                errorCategory: "internal",
            }),
        ).not.toThrow();
        expect(readTelemetryErrorClassification(frozen)).toBeUndefined();
        expect(
            readTelemetryErrorClassification(hostileObject()),
        ).toBeUndefined();
    });
});

// The classifier is published on its own as
// `@typeagent/telemetry/errorClassification` so browser-shared code can use it
// without pulling in the Node-only telemetry composition root. A Node builtin
// appearing here would either force a Node-only dependency into a browser
// bundle or break bundling on an unresolvable `node:*` import.
describe("browser-safe errorClassification boundary", () => {
    const otelSrcDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src/otel",
    );

    const NODE_BUILTINS = new Set([
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "crypto",
        "dns",
        "events",
        "fs",
        "http",
        "https",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "stream",
        "timers",
        "tls",
        "url",
        "util",
        "v8",
        "vm",
        "worker_threads",
        "zlib",
    ]);

    function isNodeBuiltin(specifier: string): boolean {
        return (
            specifier.startsWith("node:") ||
            NODE_BUILTINS.has(specifier.split("/")[0]!)
        );
    }

    // `from "x"`, bare `import "x"`, and `import("x")`. Deliberately crude:
    // over-matching (a specifier quoted in a comment, say) can only make this
    // check stricter, never weaker.
    const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

    it("imports no Node builtin and reaches no other module", async () => {
        const source = await readFile(
            path.join(otelSrcDir, "errorClassification.ts"),
            "utf8",
        );
        const specifiers = [...source.matchAll(SPECIFIER)].map(
            ([, specifier]) => specifier!,
        );
        expect(specifiers.filter(isNodeBuiltin)).toEqual([]);
        // It imports nothing at all today. Asserting that keeps the check
        // above complete: a relative import would need its own graph walk
        // before this file could still be called browser-safe.
        expect(specifiers).toEqual([]);
    });
});
