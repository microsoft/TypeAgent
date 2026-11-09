// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const secretPattern =
    /(?:\b(?:bearer\s+[a-z0-9._~+/=-]+|authorization\s*:\s*basic\s+[a-z0-9+/=]+|(?:aws_secret_access_key|aws_access_key_id|client_secret|api[_-]?key|access[_-]?token|token|password|passwd|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)|github_pat_[a-z0-9_]+|gh[pousr]_[a-z0-9]+|sk-[a-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/:@]+:[^\s/@]+@)|--(?:api[_-]?key|token|password|passwd|secret|user)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+))/gi;
const secretKey =
    /^(?:authorization|cookie|password|passwd|secret|secret[_-]?value|token|api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|(?:aws[_-]?)?secret[_-]?access[_-]?key)$/i;

function inputReference(value: unknown): boolean {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "$input" &&
        typeof Object.getOwnPropertyDescriptor(value, "$input")?.value ===
            "string"
    );
}

function redactBasicCredential(match: string, token: string): string {
    try {
        return /^[\u0020-\u007e]*:[\u0020-\u007e]*$/.test(atob(token))
            ? "[REDACTED]"
            : match;
    } catch {
        return match;
    }
}

export function redactRunbookText(value: string): string {
    if (value.length > 1_000_000) {
        throw new Error("Runbook text exceeds the redaction limit");
    }
    return value
        .replace(secretPattern, "[REDACTED]")
        .replace(/\bbasic\s+([a-z0-9+/=]+)/gi, redactBasicCredential);
}

export function redactRunbookValue(
    value: unknown,
    depth = 0,
    secretLiterals: readonly string[] = [],
    preserveInputReferences = false,
): unknown {
    if (depth > 30) {
        throw new Error("Runbook content exceeds the nesting limit");
    }
    if (typeof value === "string") {
        let redacted = redactRunbookText(value);
        for (const secret of secretLiterals) {
            redacted = redacted.split(secret).join("[REDACTED]");
        }
        return redacted;
    }
    if (preserveInputReferences && depth > 0 && inputReference(value))
        return structuredClone(value);
    if (Array.isArray(value)) {
        if (value.length > 10_000)
            throw new Error("Runbook array exceeds the redaction limit");
        return value.map((child) =>
            redactRunbookValue(
                child,
                depth + 1,
                secretLiterals,
                preserveInputReferences,
            ),
        );
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                key,
                secretKey.test(key) &&
                typeof child !== "boolean" &&
                !(preserveInputReferences && inputReference(child))
                    ? "[REDACTED]"
                    : redactRunbookValue(
                          child,
                          depth + 1,
                          secretLiterals,
                          preserveInputReferences &&
                              !(key === "$literal" && depth > 0),
                      ),
            ]),
        );
    }
    return value;
}
