// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success, error, Result } from "typechat";
import registerDebug from "debug";
import type { EndpointPool, EndpointPoolMember } from "./endpointPool.js";
import {
    markSuccess,
    markThrottled,
    markTransientFailure,
    pickEndpoint,
} from "./endpointPool.js";

const debugUrl = registerDebug("typeagent:rest:url");
const debugHeader = registerDebug("typeagent:rest:header");
const debugError = registerDebug("typeagent:rest:error");
// Always-on visibility into transient-error retries (429/5xx). Separate from
// debugError so operators see throttling even without error-level tracing.
const debugRetry = registerDebug("typeagent:rest:retry");
const debugPool = registerDebug("typeagent:pool");

function hostOf(url: string): string {
    try {
        const u = new URL(url);
        return u.host + u.pathname;
    } catch {
        return url;
    }
}

/**
 * Call an API using a JSON message body
 * @param headers
 * @param url
 * @param params
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @param timeout
 * @returns
 */
export function callApi(
    headers: Record<string, string>,
    url: string,
    params: any,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
    throttler?: FetchThrottler,
): Promise<Result<Response>> {
    const options: RequestInit = {
        method: "POST",
        body: JSON.stringify({
            ...params,
        }),
        headers: {
            "content-type": "application/json",
            ...headers,
        },
    };
    return fetchWithRetry(
        url,
        options,
        retryMaxAttempts,
        retryPauseMs,
        timeout,
        throttler,
    );
}

/**
 * Call a REST API using a JSON message body
 * Returns a Json response
 * @param headers
 * @param url
 * @param params
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @param timeout
 * @returns
 */
export async function callJsonApi(
    headers: Record<string, string>,
    url: string,
    params: any,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
    throttler?: FetchThrottler,
): Promise<Result<unknown>> {
    const result = await callApi(
        headers,
        url,
        params,
        retryMaxAttempts,
        retryPauseMs,
        timeout,
        throttler,
    );
    if (result.success) {
        try {
            return success(await result.data.json());
        } catch (e: any) {
            return error(`callJsonApi(): .json(): ${e.message}`);
        }
    }
    return result;
}

/**
 * Get Json from a url
 * @param headers
 * @param url
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @param timeout
 * @returns
 */
export async function getJson(
    headers: Record<string, string>,
    url: string,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
): Promise<Result<unknown>> {
    const options: RequestInit = {
        method: "GET",
        headers: {
            "content-type": "application/json",
            ...headers,
        },
    };
    const result = await fetchWithRetry(
        url,
        options,
        retryMaxAttempts,
        retryPauseMs,
        timeout,
    );
    if (result.success) {
        return success(await result.data.json());
    }

    return result;
}

/**
 * Get Html from a url
 * @param url
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @param timeout
 * @returns
 */
export async function getHtml(
    url: string,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
): Promise<Result<string>> {
    const result = await fetchWithRetry(
        url,
        undefined,
        retryMaxAttempts,
        retryPauseMs,
        timeout,
    );

    if (result.success) {
        return success(await result.data.text());
    }

    return result;
}

export async function getBlob(
    url: string,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
): Promise<Result<Blob>> {
    const result = await fetchWithRetry(
        url,
        undefined,
        retryMaxAttempts,
        retryPauseMs,
        timeout,
    );

    if (result.success) {
        return success(await result.data.blob());
    }

    return result;
}

/**
 * An iterator that reads a fetch response stream, decodes it and returns text chunks
 * @param response
 */
export async function* readResponseStream(
    response: Response,
): AsyncIterableIterator<string> {
    const reader = response.body?.getReader();
    if (reader) {
        const utf8Decoder = new TextDecoder("utf-8");
        const options = { stream: true };
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const text = utf8Decoder.decode(value, options);
            if (text.length > 0) {
                yield text;
            }
        }
    }
}

async function callFetch(
    url: string,
    options?: RequestInit,
    timeout?: number,
    throttler?: FetchThrottler,
) {
    return throttler
        ? throttler(() => fetchWithTimeout(url, options, timeout))
        : fetchWithTimeout(url, options, timeout);
}

export type FetchThrottler = (fn: () => Promise<Response>) => Promise<Response>;

async function getErrorMessage(
    response: Response,
    retries?: number | undefined,
    timeTaken?: number | undefined,
): Promise<string> {
    let bodyMessage = "";
    try {
        const bodyText = await response.text();
        debugError(bodyText);
        const bodyJson = JSON.parse(bodyText);
        bodyMessage = bodyJson.error;

        if (typeof bodyMessage === "object") {
            if ((bodyMessage as any).message) {
                bodyMessage = (bodyMessage as any).message;
            } else {
                bodyMessage = JSON.stringify(bodyMessage);
            }
        }
    } catch (e) {}
    return `${response.status}: ${response.statusText}${bodyMessage ? `: ${bodyMessage}` : ""}${retries !== undefined ? ` Quitting after ${retries} retries` : ""}${timeTaken !== undefined ? ` in ${timeTaken}ms` : ""}`;
}

/**
 * fetch that automatically retries transient Http errors
 * @param url
 * @param options
 * @param retryMaxAttempts (optional) maximum number of retry attempts
 * @param retryPauseMs (optional) # of milliseconds to pause before retrying
 * @param timeout (optional) set custom timeout in milliseconds
 * @param throttler (optional) function to throttle fetch calls
 * @returns Response object
 */
export async function fetchWithRetry(
    url: string,
    options?: RequestInit,
    retryMaxAttempts?: number,
    retryPauseMs?: number,
    timeout?: number,
    throttler?: FetchThrottler,
) {
    retryMaxAttempts ??= 3;
    retryPauseMs ??= 1000;
    // Default total budget of 3 minutes. Previous default of 60s meant a single
    // `Retry-After: 60` response would exhaust the budget before the retry
    // even fired. Per-fetch calls should resolve in seconds; this cap only
    // matters when retrying through transient throttling.
    timeout ??= 180_000;

    const backOffFactor = 3_000;
    let retryCount = 0;
    const startTime: number = Date.now();
    const host = hostOf(url);
    try {
        while (true) {
            const result = await callFetch(url, options, timeout, throttler);
            if (result === undefined) {
                throw new Error("fetch: No response");
            }
            debugHeader(result.status, result.statusText);
            debugHeader(result.headers);
            if (result.status === 200 || result.status === 201) {
                if (retryCount > 0) {
                    debugRetry(
                        `recovered ${host} after ${retryCount} retr${retryCount === 1 ? "y" : "ies"} in ${Date.now() - startTime}ms`,
                    );
                }
                return success(result);
            }
            const elapsed = Date.now() - startTime;
            if (
                !isTransientHttpError(result.status) || // non-transient error
                retryCount >= retryMaxAttempts || // exceeded max retries
                elapsed > timeout // exceeded total time allowed
            ) {
                const reason = !isTransientHttpError(result.status)
                    ? `non-transient status ${result.status}`
                    : retryCount >= retryMaxAttempts
                      ? `exhausted ${retryMaxAttempts} retries`
                      : `exceeded ${timeout}ms budget (${elapsed}ms elapsed)`;
                debugRetry(
                    `giving up on ${host}: ${reason}, status=${result.status}`,
                );
                return error(
                    `fetch error: ${await getErrorMessage(result, retryCount, elapsed)}`,
                );
            } else if (debugError.enabled) {
                debugError(await getErrorMessage(result));
            }

            // See if the service tells how long to wait to retry
            const rawRetryAfter = result.headers.get("Retry-After");
            const pauseMs = getRetryAfterMs(result, retryPauseMs);
            const totalWait =
                pauseMs + retryCount * backOffFactor + getRandomDelay();

            debugRetry(
                `retry ${retryCount + 1}/${retryMaxAttempts} on ${host}: status=${result.status}` +
                    ` retryAfter=${rawRetryAfter ?? "<none>"}` +
                    ` pause=${pauseMs}ms backoff=${retryCount * backOffFactor}ms totalWait=${totalWait}ms` +
                    ` elapsed=${elapsed}ms budget=${timeout}ms`,
            );

            // wait before retrying
            // wait at least as long as the Retry-After header, plus a back-off factor that increases with each retry
            // plus a random delay to avoid thundering herd
            await sleep(totalWait);

            retryCount++;
        }
    } catch (e: any) {
        if (e.name === "AbortError") {
            throw e;
        }
        return error(`fetch error: ${e.cause?.message ?? e.message}`);
    }
}

/**
 * When servers return a 429, they can include a Retry-After header that says how long the caller
 * should wait before retrying
 * @param result
 * @param defaultValue
 * @returns How many milliseconds to pause before retrying
 */
export function getRetryAfterMs(
    result: Response,
    defaultValue: number,
): number {
    try {
        let pauseHeader = result.headers.get("Retry-After");
        if (pauseHeader !== null) {
            // console.log(`Retry-After: ${pauseHeader}`);
            pauseHeader = pauseHeader.trim();
            if (pauseHeader) {
                let seconds = parseInt(pauseHeader);
                let pauseMs: number;
                if (isNaN(seconds)) {
                    const retryDate = new Date(pauseHeader);
                    pauseMs = retryDate.getTime() - Date.now(); // Already in ms
                } else {
                    pauseMs = seconds * 1000;
                }
                if (pauseMs > 0) {
                    return pauseMs;
                }
            }
        }
    } catch (err: any) {
        console.log(`Failed to parse Retry-After header ${err}`);
    }
    return defaultValue;
}

/**
 *
 * @param min - The minimum delay in milliseconds (default 1 second)
 * @param max - The maximum delay in milliseconds (default 5 seconds)
 * @returns A random delay between the min and max
 */
function getRandomDelay(min: number = 1_000, max: number = 5_000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchWithTimeout(
    url: string,
    options?: RequestInit,
    timeoutMs?: number,
): Promise<Response> {
    debugUrl(url);

    // Combine timeout and any caller-provided abort signal
    const externalSignal = options?.signal;
    if (!timeoutMs || timeoutMs <= 0) {
        return fetch(url, options);
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    // If the caller provided a signal (e.g. for cancellation), forward its
    // abort to our controller so a single signal drives the fetch.
    let onExternalAbort: (() => void) | undefined;
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(id);
            throw (
                externalSignal.reason ??
                new DOMException("The operation was aborted.", "AbortError")
            );
        }
        onExternalAbort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener("abort", onExternalAbort);
    }

    try {
        const response = await fetch(
            url,
            options
                ? {
                      ...options,
                      signal: controller.signal,
                  }
                : {
                      signal: controller.signal,
                  },
        );
        return response;
    } catch (e) {
        const ex = e as Error;
        // If the external signal caused the abort, re-throw as AbortError
        if (ex.name === "AbortError" && externalSignal?.aborted) {
            throw e;
        }
        if (ex.name === "AbortError") {
            throw new Error(`fetch timeout ${timeoutMs}ms`);
        }
        throw e;
    } finally {
        clearTimeout(id);
        if (onExternalAbort && externalSignal) {
            externalSignal.removeEventListener("abort", onExternalAbort);
        }
    }
}

enum HttpStatusCode {
    TooManyRequests = 429,
    InternalServerError = 500,
    BadGateway = 502,
    ServiceUnavailable = 503,
    GatewayTimeout = 504,
}

/**
 * Returns true of the given HTTP status code represents a transient error.
 */
function isTransientHttpError(code: number): boolean {
    switch (code) {
        case HttpStatusCode.TooManyRequests:
        case HttpStatusCode.InternalServerError:
        case HttpStatusCode.BadGateway:
        case HttpStatusCode.ServiceUnavailable:
        case HttpStatusCode.GatewayTimeout:
            return true;
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Endpoint-pool aware variants
//
// When a caller has more than one endpoint configured (e.g. multiple Azure
// OpenAI regions behind the same model name), these wrappers select a member,
// invoke fetchWithRetry against that one endpoint with retryMaxAttempts=1
// (so the inner layer doesn't re-hit the same URL), and rotate to another
// member on 429/5xx. The pool of one case is a direct delegate to the
// existing fetchWithRetry path, preserving today's behavior byte-for-byte.
// ---------------------------------------------------------------------------

export type PoolRequestContext = {
    headers: Record<string, string>;
    body?: any;
};

/**
 * Caller supplies this to build per-member headers (and optional body). Called
 * once per pick, so an Azure AD token refresh can happen per-endpoint.
 */
export type BuildPoolRequest = (
    member: EndpointPoolMember,
) => Promise<Result<PoolRequestContext>>;

export type PoolCallOptions = {
    overallBudgetMs?: number | undefined;
    retryPauseMs?: number | undefined;
};

async function fetchWithPool(
    pool: EndpointPool,
    method: "POST" | "GET",
    buildRequest: BuildPoolRequest,
    options?: PoolCallOptions,
): Promise<Result<Response>> {
    // One-member shortcut: fall through to the legacy retry path with the
    // member's own retry budget so behavior is identical to today for users
    // who haven't opted into a multi-region pool.
    if (pool.members.length === 1) {
        const member = pool.members[0];
        const req = await buildRequest(member);
        if (!req.success) return req;
        const init: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                ...req.data.headers,
            },
        };
        if (method === "POST" && req.data.body !== undefined) {
            init.body = JSON.stringify(req.data.body);
        }
        const settings = member.settings;
        return fetchWithRetry(
            settings.endpoint,
            init,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
            settings.timeout,
            settings.throttler,
        );
    }

    // Multi-member branch. We bypass fetchWithRetry here because we need the
    // raw Response (to parse Retry-After and route on status) — fetchWithRetry
    // swallows the Response and only returns a stringified error. Every
    // per-member call goes through callFetch directly; the pool wrapper owns
    // rotation, cooldown, and overall-budget enforcement.
    const overallBudgetMs = options?.overallBudgetMs ?? 180_000;
    const startTime = Date.now();
    let lastError: Result<Response> | undefined;
    let attempts = 0;

    while (true) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= overallBudgetMs) {
            debugPool(
                `pool ${pool.modelKey} exhausted ${overallBudgetMs}ms budget after ${attempts} attempts`,
            );
            return (
                lastError ??
                error(
                    `pool ${pool.modelKey} budget exhausted before any attempt`,
                )
            );
        }
        const budgetLeft = overallBudgetMs - elapsed;

        const pick = pickEndpoint(pool);
        if (pick.kind === "cooling") {
            const wait = Math.min(pick.waitMs, budgetLeft);
            debugPool(
                `pool ${pool.modelKey} all cooling; sleeping ${wait}ms for ${pick.member.suffix || "<bare>"}`,
            );
            await sleep(wait);
            continue;
        }

        const member = pick.member;
        const req = await buildRequest(member);
        if (!req.success) {
            // buildRequest failure (e.g. Azure AD token acquisition) is not
            // per-endpoint recoverable — bubble it out rather than rotating.
            return req;
        }
        const init: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                ...req.data.headers,
            },
        };
        if (method === "POST" && req.data.body !== undefined) {
            init.body = JSON.stringify(req.data.body);
        }

        attempts += 1;
        debugPool(
            `pool ${pool.modelKey} -> ${member.suffix || "<bare>"} (priority=${member.priority}, mode=${member.mode}), attempt ${attempts}`,
        );

        const perAttemptTimeout = Math.min(
            member.settings.timeout ?? budgetLeft,
            budgetLeft,
        );

        let response: Response | undefined;
        try {
            response = await callFetch(
                member.settings.endpoint,
                init,
                perAttemptTimeout,
                member.settings.throttler,
            );
        } catch (e: any) {
            // Network error, timeout (AbortError re-thrown as "fetch timeout"),
            // or connection reset. Treat as transient and rotate.
            debugPool(
                `pool ${pool.modelKey} ${member.suffix || "<bare>"} threw: ${e?.message ?? e}`,
            );
            markTransientFailure(member);
            lastError = error(
                `fetch error: ${e?.cause?.message ?? e?.message ?? String(e)}`,
            );
            continue;
        }

        if (response.status === 200 || response.status === 201) {
            markSuccess(member);
            return success(response);
        }

        if (response.status === 429) {
            // Parse Retry-After and pass it to the pool-level cooldown so
            // the member isn't revisited before the server is ready.
            const retryAfterMs = getRetryAfterMs(response, 0);
            markThrottled(member, retryAfterMs > 0 ? retryAfterMs : undefined);
            lastError = error(
                `fetch error: ${await getErrorMessage(response, attempts, Date.now() - startTime)}`,
            );
            continue;
        }

        if (isTransientHttpError(response.status)) {
            // 5xx — transient at the server level. Rotate without extending
            // the 429 exponential.
            markTransientFailure(member);
            lastError = error(
                `fetch error: ${await getErrorMessage(response, attempts, Date.now() - startTime)}`,
            );
            continue;
        }

        // Non-transient 4xx (e.g. 401, 403, 400). Don't rotate — the caller
        // gets the same outcome from every endpoint.
        return error(
            `fetch error: ${await getErrorMessage(response, attempts, Date.now() - startTime)}`,
        );
    }
}

/**
 * Pool-aware variant of callJsonApi. Picks a pool member, calls POST, and
 * rotates on 429/5xx. Returns parsed JSON on success.
 */
export async function callJsonApiWithPool(
    pool: EndpointPool,
    buildRequest: BuildPoolRequest,
    options?: PoolCallOptions,
): Promise<Result<unknown>> {
    const response = await fetchWithPool(pool, "POST", buildRequest, options);
    if (!response.success) return response;
    try {
        return success(await response.data.json());
    } catch (e: any) {
        return error(`callJsonApiWithPool(): .json(): ${e.message}`);
    }
}

/**
 * Pool-aware variant of callApi. Returns the raw Response (caller will stream
 * the body themselves).
 */
export async function callApiWithPool(
    pool: EndpointPool,
    buildRequest: BuildPoolRequest,
    options?: PoolCallOptions,
): Promise<Result<Response>> {
    return fetchWithPool(pool, "POST", buildRequest, options);
}
