// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function classifyRequestError(error, context = {}) {
    const code = error?.cause?.code ?? error?.code;
    const name = error?.name;
    const base = { name, ...(typeof code === "string" ? { code } : {}) };
    if (context.timeout || name === "TimeoutError")
        return { ...base, class: "local-timeout" };
    if (context.localStop || context.signalAborted || name === "AbortError")
        return { ...base, class: "local-cancellation" };
    if (context.fromFetch && (name === "TypeError" || typeof code === "string"))
        return { ...base, class: "network-transport" };
    return { ...base, class: "local-or-unclassified" };
}

export function requestFailureClass(request) {
    if (Number.isInteger(request.status) && request.status >= 400)
        return "provider-http";
    return request.error?.class;
}

export function transportFailedPass(requests) {
    return requests.some((request) =>
        [
            "provider-http",
            "network-transport",
            "provider-response-error",
        ].includes(requestFailureClass(request)),
    );
}

export async function observedFetch(
    fetcher,
    input,
    init,
    records,
    context = {},
) {
    const startedEpochMs = Date.now();
    const record = { startedEpochMs };
    records.push(record);
    try {
        const response = await fetcher(input, init);
        record.status = response.status;
        record.elapsedMs = Date.now() - startedEpochMs;
        const type = response.headers.get("content-type") ?? "";
        if (type.includes("application/json")) {
            const data = await response.clone().json();
            if (data?.usage) record.usage = data.usage;
            if (data?.error)
                record.error = {
                    class:
                        response.status >= 400
                            ? "provider-http"
                            : "provider-response-error",
                    ...(typeof data.error.code === "string"
                        ? { code: data.error.code }
                        : {}),
                };
        }
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter !== null) record.retryAfter = retryAfter;
        return response;
    } catch (error) {
        record.error = classifyRequestError(error, {
            ...context,
            fromFetch: true,
            signalAborted: init?.signal?.aborted,
        });
        record.elapsedMs = Date.now() - startedEpochMs;
        throw error;
    }
}
