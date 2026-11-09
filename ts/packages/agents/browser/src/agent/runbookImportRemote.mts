// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import {
    createPinnedLookup,
    resolvePublicIpAddress,
} from "@typeagent/common-utils/network";

export interface AcquiredRunbookUrl {
    url: string;
    text: string;
    mimeType: "text/html" | "text/markdown" | "text/plain";
}
export interface RunbookRemoteDependencies {
    resolve?: typeof resolvePublicIpAddress;
    request?: typeof httpRequest;
}
const maximumBytes = 2 * 1024 * 1024;

export function runbookPublicUrl(raw: string): URL {
    const url = new URL(raw);
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        Array.from(url.searchParams.keys()).some((key) =>
            /^(?:access[-_]?token|api[-_]?key|auth(?:orization)?|password|token|secret|sig(?:nature)?|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))$/i.test(
                key,
            ),
        ) ||
        (url.port && !["80", "443"].includes(url.port))
    )
        throw new Error(
            "Only credential-free public HTTP(S) URLs on standard ports are supported.",
        );
    url.hash = "";
    return url;
}

function responseBytes(response: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("error", reject);
        response.on("aborted", () =>
            reject(new Error("Remote response was interrupted.")),
        );
        response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximumBytes) {
                response.destroy(
                    new Error(
                        "Remote document exceeds 2 MB; nothing was truncated.",
                    ),
                );
                return;
            }
            chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
    });
}

async function resolveBounded(
    hostname: string,
    resolve: typeof resolvePublicIpAddress,
) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            resolve(hostname),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () =>
                        reject(
                            new Error("Remote hostname resolution timed out."),
                        ),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

async function requestOnce(url: URL, dependencies: RunbookRemoteDependencies) {
    const address = await resolveBounded(
        url.hostname,
        dependencies.resolve ?? resolvePublicIpAddress,
    );
    const request =
        dependencies.request ??
        (url.protocol === "https:" ? httpsRequest : httpRequest);
    return new Promise<{ response: IncomingMessage; bytes: Buffer }>(
        (resolve, reject) => {
            const operation = request(
                url,
                {
                    ...createPinnedLookup(address),
                    headers: {
                        accept: "text/html, text/markdown, text/plain",
                        "accept-encoding": "identity",
                        "user-agent": "TypeAgent-Runbook-Import/1.0",
                    },
                    signal: AbortSignal.timeout(15000),
                },
                (response) => {
                    const length = Number(response.headers["content-length"]);
                    if (Number.isFinite(length) && length > maximumBytes) {
                        response.destroy();
                        reject(
                            new Error(
                                "Remote document exceeds 2 MB; nothing was truncated.",
                            ),
                        );
                        return;
                    }
                    void responseBytes(response).then(
                        (bytes) => resolve({ response, bytes }),
                        reject,
                    );
                },
            );
            operation.on("error", reject);
            operation.end();
        },
    );
}

function documentMime(
    response: IncomingMessage,
): AcquiredRunbookUrl["mimeType"] {
    const header = response.headers["content-type"] ?? "";
    const mime = header.split(";")[0].trim().toLowerCase();
    const charset = /charset\s*=\s*"?([^";\s]+)/i
        .exec(header)?.[1]
        ?.toLowerCase();
    if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset))
        throw new Error(`Unsupported document charset: ${charset}.`);
    if (
        response.headers["content-encoding"] &&
        response.headers["content-encoding"] !== "identity"
    )
        throw new Error(
            "Compressed remote documents are unavailable for bounded import.",
        );
    if (!["text/html", "text/markdown", "text/plain"].includes(mime))
        throw new Error(
            `Unsupported remote format: ${mime || "missing Content-Type"}.`,
        );
    return mime as AcquiredRunbookUrl["mimeType"];
}

export async function acquireRunbookUrl(
    raw: string,
    dependencies: RunbookRemoteDependencies = {},
): Promise<AcquiredRunbookUrl> {
    let url = runbookPublicUrl(raw);
    for (let redirect = 0; redirect <= 3; redirect++) {
        const { response, bytes } = await requestOnce(url, dependencies);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
            if (redirect === 3)
                throw new Error("Remote redirect limit exceeded.");
            url = runbookPublicUrl(
                new URL(response.headers.location, url).href,
            );
            continue;
        }
        if (status < 200 || status >= 300)
            throw new Error(
                `Remote document returned HTTP ${status}; authentication is never forwarded.`,
            );
        const mimeType = documentMime(response);
        const text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
        }).decode(bytes);
        if (!text.trim()) throw new Error("Remote document is empty.");
        return { url: url.href, text, mimeType };
    }
    throw new Error("Remote redirect limit exceeded.");
}
