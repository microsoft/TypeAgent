// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success, error, Result } from "typechat";
import registerDebug from "debug";

const debugUrl = registerDebug("typeagent:rest:url");
const debugHeader = registerDebug("typeagent:rest:header");
const debugError = registerDebug("typeagent:rest:error");

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
    timeout ??= 60_000; // default to 1 minute

    const backOffFactor = 3_000;
    let retryCount = 0;
    const startTime: number = Date.now();
    try {
        while (true) {
            const result = await callFetch(url, options, timeout, throttler);
            if (result === undefined) {
                throw new Error("fetch: No response");
            }
            debugHeader(result.status, result.statusText);
            debugHeader(result.headers);
            if (result.status === 200 || result.status === 201) {
                return success(result);
            }
            if (
                !isTransientHttpError(result.status) || // non-transient error
                retryCount >= retryMaxAttempts || // exceeded max retries
                Date.now() - startTime > timeout // exceeded total time allowed
            ) {
                return error(
                    `fetch error: ${await getErrorMessage(result, retryCount, Date.now() - startTime)}`,
                );
            } else if (debugError.enabled) {
                debugError(await getErrorMessage(result));
            }

            // See if the service tells how long to wait to retry
            const pauseMs = getRetryAfterMs(result, retryPauseMs);

            // wait before retrying
            // wait at least as long as the Retry-After header, plus a back-off factor that increases with each retry
            // plus a random delay to avoid thundering herd
            await sleep(
                pauseMs + retryCount * backOffFactor + getRandomDelay(),
            );

            retryCount++;
        }
    } catch (e: any) {
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
    if (!timeoutMs || timeoutMs <= 0) {
        return fetch(url, options);
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
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
        if (ex.name && ex.name === "AbortError") {
            throw new Error(`fetch timeout ${timeoutMs}ms`);
        } else {
            throw e;
        }
    } finally {
        clearTimeout(id);
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
