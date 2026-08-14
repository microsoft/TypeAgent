const secretKey =
    /^(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key)$/i;
const secretValue =
    /\b(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+|github_pat_[a-z0-9_]+|gh[pousr]_[a-z0-9]+|sk-[a-z0-9_-]{16,})/gi;

export function redactTraceValue(value: unknown): unknown {
    if (typeof value === "string") {
        return value.replace(secretValue, "[REDACTED]");
    }
    if (Array.isArray(value)) {
        return value.map(redactTraceValue);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                secretKey.test(key) ? "[REDACTED]" : redactTraceValue(entry),
            ]),
        );
    }
    return value;
}
