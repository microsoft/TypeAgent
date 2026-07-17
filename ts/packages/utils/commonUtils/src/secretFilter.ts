// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// A dependency-free secret scrubber for redacting credentials out of text
// before it is logged, persisted, or sent to a third party (e.g. an LLM
// prompt). It combines two independent layers:
//
//   1. Known-value redaction - literal occurrences of secret *values* the
//      caller already holds (API keys read from config, tokens, etc.).
//   2. Pattern redaction - a curated list of regexes that match common secret
//      *formats* (GitHub tokens, JWTs, cloud keys, `Bearer ...`, etc.).
//
// The pattern list is authored from publicly documented secret formats
// (GitHub secret-scanning, gitleaks/detect-secrets style detectors); it is not
// derived from any proprietary source. It catches formatted or known secrets,
// but cannot detect an arbitrary high-entropy value with no recognizable
// prefix - treat it as defense-in-depth, not a guarantee.

/** Sentinel written in place of a redacted secret. */
export const DEFAULT_SECRET_REPLACEMENT = "******";

// Known values shorter than this are ignored, both to avoid redacting trivial
// tokens that legitimately appear everywhere and to prevent a stray short/empty
// value from blanking out unrelated text.
const MIN_VALUE_LENGTH = 4;

/**
 * A named secret-format detector.
 *
 * `regex` MUST carry the global (`g`) flag so every occurrence is replaced.
 * When `group` is set, only that capture group is redacted and the surrounding
 * match (e.g. a `Bearer ` prefix or a `password=` key) is preserved; otherwise
 * the whole match is replaced.
 */
export interface SecretPattern {
    readonly name: string;
    readonly regex: RegExp;
    readonly group?: number;
}

/**
 * Curated detectors for common secret formats. Exported so callers can inspect,
 * subset, or extend the list (e.g. `[...SECRET_PATTERNS, myPattern]`).
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
    // PEM-encoded private keys (RSA / EC / DSA / OpenSSH / PGP / generic).
    {
        name: "private-key",
        regex: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    },
    // JSON Web Tokens: three base64url segments separated by dots.
    {
        name: "jwt",
        regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    },
    // GitHub classic PAT / OAuth / app / refresh tokens (ghp_, gho_, ghu_, ghs_, ghr_).
    { name: "github-token", regex: /\bgh[opsur]_[A-Za-z0-9]{36,}\b/g },
    // GitHub fine-grained personal-access tokens.
    {
        name: "github-fine-grained-pat",
        regex: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g,
    },
    // GitHub OAuth access tokens of the form v1.<40 hex>.
    { name: "github-oauth-v1", regex: /\bv1\.[0-9a-f]{40}\b/g },
    // OpenAI API keys, including project-scoped `sk-proj-` keys.
    { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
    // AWS access key IDs.
    {
        name: "aws-access-key-id",
        regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
    },
    // Google API keys.
    { name: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    // Slack tokens (bot / user / app / refresh / legacy).
    { name: "slack-token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
    // npm access tokens.
    { name: "npm-token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
    // Azure shared-key connection-string fragments (Storage / Service Bus / etc.).
    {
        name: "azure-account-key",
        regex: /\b(AccountKey=)([A-Za-z0-9+/=]{40,})/gi,
        group: 2,
    },
    // Credentials embedded in a URL: scheme://user:password@host - redact the password.
    {
        name: "url-basic-auth",
        regex: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)@/gi,
        group: 2,
    },
    // HTTP Bearer authorization tokens - redact the token, keep the `Bearer ` prefix.
    {
        name: "bearer-token",
        regex: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
        group: 2,
    },
    // password / passwd / pwd assignments (optionally quoted key and value) -
    // redact the value, keep the key so the surrounding text stays readable.
    {
        name: "password-assignment",
        regex: /(?:password|passwd|pwd)"?\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s'";,)}]+)/gi,
        group: 1,
    },
    // Command-line password flags: -Password value / --pwd "value".
    {
        name: "password-flag",
        regex: /(?:^|\s)-{1,2}(?:password|passwd|pwd)\s+("[^"]*"|'[^']*'|[^\s'";]+)/gi,
        group: 1,
    },
];

/** Options for {@link filterSecrets}. */
export interface FilterSecretsOptions {
    /** Literal secret values to redact wherever they appear. */
    readonly values?: Iterable<string> | undefined;
    /** Format detectors to apply. Defaults to {@link SECRET_PATTERNS}. */
    readonly patterns?: readonly SecretPattern[] | undefined;
    /** Replacement sentinel. Defaults to {@link DEFAULT_SECRET_REPLACEMENT}. */
    readonly replacement?: string | undefined;
    /**
     * Predicate to skip a string entirely (returned unchanged when it returns
     * true). Use it to leave opaque blobs alone - e.g. base64 `data:` image
     * URLs, which are large (hot-path cost) and whose random base64 can
     * coincidentally match a key pattern and be corrupted by redaction.
     */
    readonly skipValue?: ((value: string) => boolean) | undefined;
}

function applyPattern(
    text: string,
    pattern: SecretPattern,
    replacement: string,
): string {
    if (pattern.group === undefined) {
        return text.replace(pattern.regex, replacement);
    }
    const group = pattern.group;
    return text.replace(pattern.regex, (match, ...args) => {
        // args = [g1, g2, ..., offset, wholeString, (namedGroups?)]
        const captured = args[group - 1];
        if (typeof captured !== "string" || captured.length === 0) {
            return match;
        }
        // Redact only the captured credential within the match, leaving any
        // prefix (e.g. `Bearer ` or `password=`) intact. lastIndexOf keeps the
        // right target when the prefix cannot contain the captured value.
        const at = match.lastIndexOf(captured);
        if (at < 0) {
            return match;
        }
        return (
            match.slice(0, at) + replacement + match.slice(at + captured.length)
        );
    });
}

/**
 * Return `text` with known secret values and recognizable secret formats
 * replaced by a redaction sentinel. Non-string input is returned unchanged.
 */
export function filterSecrets(
    text: string,
    options?: FilterSecretsOptions,
): string {
    if (typeof text !== "string" || text.length === 0) {
        return text;
    }
    if (options?.skipValue?.(text)) {
        return text;
    }
    const replacement = options?.replacement ?? DEFAULT_SECRET_REPLACEMENT;
    const patterns = options?.patterns ?? SECRET_PATTERNS;

    let out = text;

    // Known values first, longest-first so a value that is a substring of a
    // longer value does not partially redact and prevent the longer match.
    if (options?.values) {
        const values = [...options.values]
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length >= MIN_VALUE_LENGTH)
            .sort((a, b) => b.length - a.length);
        for (const value of values) {
            out = out.replaceAll(value, replacement);
        }
    }

    for (const pattern of patterns) {
        out = applyPattern(out, pattern, replacement);
    }

    return out;
}

function walkValue(value: unknown, options?: FilterSecretsOptions): unknown {
    if (typeof value === "string") {
        return filterSecrets(value, options);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => walkValue(item, options));
    }
    // Only recurse into plain objects. Class instances, Date, RegExp, Map,
    // etc. pass through untouched - rebuilding them from entries would drop
    // their prototype, and structured telemetry / request payloads are plain
    // JSON-shaped objects anyway.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
    )) {
        out[key] = walkValue(item, options);
    }
    return out;
}

/**
 * Recursively redact secrets from every string in `value`, returning a new
 * value of the same shape. Arrays and plain objects are copied; numbers,
 * booleans, null, and non-plain objects (Date, RegExp, class instances) pass
 * through unchanged. Use this to scrub a structured payload (a log event, a
 * request body) without disturbing its structure or non-string fields.
 */
export function filterSecretsFromObject<T>(
    value: T,
    options?: FilterSecretsOptions,
): T {
    return walkValue(value, options) as T;
}

/**
 * Redact secrets from a JSON string while keeping it valid JSON: parse it,
 * scrub every string value, and re-serialize. If `json` is not valid JSON it
 * is scrubbed as raw text instead. Always returns a string.
 */
export function filterSecretsFromJsonString(
    json: string,
    options?: FilterSecretsOptions,
): string {
    if (typeof json !== "string" || json.length === 0) {
        return json;
    }
    try {
        const parsed: unknown = JSON.parse(json);
        return JSON.stringify(filterSecretsFromObject(parsed, options));
    } catch {
        return filterSecrets(json, options);
    }
}

/**
 * A stateful scrubber that accumulates known secret values and applies them
 * (plus the configured format detectors) on every {@link SecretFilter.filter}
 * call. Use this when secret values become known incrementally - for example
 * registering each credential as it is read from config.
 */
export interface SecretFilter {
    /** Register a secret value. Returns false if ignored (too short / duplicate). */
    addValue(value: string): boolean;
    /** Register several secret values. */
    addValues(values: Iterable<string>): void;
    /** Redact registered values and format detectors from `text`. */
    filter(text: string): string;
    /** Number of distinct values currently registered. */
    readonly size: number;
}

/** Options for {@link createSecretFilter}. */
export interface CreateSecretFilterOptions {
    readonly patterns?: readonly SecretPattern[] | undefined;
    readonly replacement?: string | undefined;
    readonly initialValues?: Iterable<string> | undefined;
}

/** Create a stateful {@link SecretFilter}. */
export function createSecretFilter(
    options?: CreateSecretFilterOptions,
): SecretFilter {
    const values = new Set<string>();
    const patterns = options?.patterns ?? SECRET_PATTERNS;
    const replacement = options?.replacement ?? DEFAULT_SECRET_REPLACEMENT;

    const addValue = (value: string): boolean => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (trimmed.length < MIN_VALUE_LENGTH || values.has(trimmed)) {
            return false;
        }
        values.add(trimmed);
        return true;
    };

    if (options?.initialValues) {
        for (const value of options.initialValues) {
            addValue(value);
        }
    }

    return {
        addValue,
        addValues(vs: Iterable<string>): void {
            for (const value of vs) {
                addValue(value);
            }
        },
        filter(text: string): string {
            return filterSecrets(text, { values, patterns, replacement });
        },
        get size(): number {
            return values.size;
        },
    };
}
