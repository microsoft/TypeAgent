// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    filterSecrets,
    filterSecretsFromObject,
    filterSecretsFromJsonString,
    createSecretFilter,
    SECRET_PATTERNS,
    DEFAULT_SECRET_REPLACEMENT,
} from "../src/secretFilter.js";

const R = DEFAULT_SECRET_REPLACEMENT;

describe("filterSecrets - format patterns", () => {
    test.each([
        ["github classic token", "token=ghp_" + "a".repeat(36)],
        ["github oauth token", "gho_" + "b".repeat(36)],
        [
            "github fine-grained pat",
            "github_pat_" + "A".repeat(22) + "_" + "B".repeat(59),
        ],
        ["github v1 oauth", "v1." + "a".repeat(40)],
        ["openai key", "sk-" + "A1b2C3d4E5f6G7h8I9j0"],
        ["openai project key", "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0kk"],
        ["aws access key id", "AKIAIOSFODNN7EXAMPLE"],
        ["google api key", "AIza" + "Sy0123456789_-abcdefghijklmnopqrstu"],
        ["slack token", "xoxb-1234567890-abcdefABCDEF"],
        ["npm token", "npm_" + "z".repeat(36)],
        [
            "jwt",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
                "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0." +
                "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        ],
    ])("redacts %s", (_label, secret) => {
        const out = filterSecrets(`before ${secret} after`);
        expect(out).not.toContain(secret);
        expect(out).toContain(R);
        // Surrounding text is preserved.
        expect(out.startsWith("before ")).toBe(true);
        expect(out.endsWith(" after")).toBe(true);
    });

    test("redacts a PEM private key block", () => {
        const key = [
            "-----BEGIN RSA PRIVATE KEY-----",
            "MIIEowIBAAKCAQEA1234567890",
            "abcdefghijklmnopqrstuvwxyz",
            "-----END RSA PRIVATE KEY-----",
        ].join("\n");
        const out = filterSecrets(`key:\n${key}\ndone`);
        expect(out).toBe(`key:\n${R}\ndone`);
    });

    test("redacts Azure AccountKey but keeps surrounding fields", () => {
        const conn =
            "Endpoint=sb://x.net/;SharedAccessKeyName=k;AccountKey=" +
            "A".repeat(64) +
            "==";
        const out = filterSecrets(conn);
        expect(out).toContain("Endpoint=sb://x.net/;");
        expect(out).toContain("SharedAccessKeyName=k;");
        expect(out).toContain("AccountKey=" + R);
    });
});

describe("filterSecrets - group-scoped patterns keep context", () => {
    test("bearer token keeps the Bearer prefix", () => {
        const out = filterSecrets("authorization: Bearer abcdef0123456789xyz");
        expect(out).toBe(`authorization: Bearer ${R}`);
    });

    test("URL basic-auth redacts only the password", () => {
        const out = filterSecrets("db at https://user:hunter2pass@host:5432/x");
        expect(out).toBe(`db at https://user:${R}@host:5432/x`);
    });

    test("password assignment keeps the key", () => {
        expect(filterSecrets("password=hunter2secret")).toBe(`password=${R}`);
        expect(filterSecrets("--Pwd 's3cr3t value'")).toBe(`--Pwd ${R}`);
    });

    test("JSON-style quoted password redacts the value only", () => {
        const out = filterSecrets('{ "password": "hunter2secret" }');
        expect(out).toBe(`{ "password": ${R} }`);
    });
});

describe("filterSecrets - known values", () => {
    test("redacts registered literal values", () => {
        const out = filterSecrets("api key is SUPER-secret-value-123 ok", {
            values: ["SUPER-secret-value-123"],
        });
        expect(out).toBe(`api key is ${R} ok`);
    });

    test("redacts longer overlapping value fully (longest-first)", () => {
        const out = filterSecrets("token abcdef-1234 here", {
            values: ["abcdef", "abcdef-1234"],
        });
        expect(out).toBe(`token ${R} here`);
        expect(out).not.toContain("1234");
    });

    test("ignores empty / whitespace / too-short values", () => {
        const text = "keep ab cd this text intact";
        const out = filterSecrets(text, { values: ["", "   ", "ab"] });
        expect(out).toBe(text);
    });

    test("honors a custom replacement", () => {
        const out = filterSecrets("v = ghp_" + "a".repeat(36), {
            replacement: "[SECRET]",
        });
        expect(out).toBe("v = [SECRET]");
    });
});

describe("filterSecrets - no false positives", () => {
    test.each([
        "the password is on the sticky note",
        "commit 0123456789abcdef0123456789abcdef01234567",
        "just some ordinary prose without any secrets",
        "email me at user@example.com about the bearer of news",
    ])("leaves %j unchanged", (text) => {
        expect(filterSecrets(text)).toBe(text);
    });

    test("returns empty string unchanged", () => {
        expect(filterSecrets("")).toBe("");
    });
});

describe("filterSecrets - reuse safety", () => {
    test("global-flag patterns behave consistently across calls", () => {
        const secret = "ghp_" + "c".repeat(36);
        const first = filterSecrets(`a ${secret} b`);
        const second = filterSecrets(`a ${secret} b`);
        expect(first).toBe(second);
        expect(first).toBe(`a ${R} b`);
    });

    test("redacts multiple occurrences in one string", () => {
        const secret = "npm_" + "d".repeat(36);
        const out = filterSecrets(`${secret} and ${secret}`);
        expect(out).toBe(`${R} and ${R}`);
    });
});

describe("createSecretFilter", () => {
    test("accumulates values and applies patterns", () => {
        const filter = createSecretFilter();
        expect(filter.addValue("my-registered-token-xyz")).toBe(true);
        const out = filter.filter(
            "my-registered-token-xyz and ghp_" + "a".repeat(36),
        );
        expect(out).toBe(`${R} and ${R}`);
    });

    test("addValue dedups and rejects too-short values", () => {
        const filter = createSecretFilter();
        expect(filter.addValue("abcd")).toBe(true);
        expect(filter.addValue("abcd")).toBe(false); // duplicate
        expect(filter.addValue("ab")).toBe(false); // too short
        expect(filter.size).toBe(1);
    });

    test("seeds from initialValues and supports addValues", () => {
        const filter = createSecretFilter({
            initialValues: ["seed-value-1234"],
        });
        filter.addValues(["another-value-5678", "x"]);
        expect(filter.size).toBe(2);
        const out = filter.filter("seed-value-1234 / another-value-5678");
        expect(out).toBe(`${R} / ${R}`);
    });

    test("honors a custom replacement and pattern subset", () => {
        const onlyNpm = SECRET_PATTERNS.filter((p) => p.name === "npm-token");
        const filter = createSecretFilter({
            patterns: onlyNpm,
            replacement: "XX",
        });
        // npm token is redacted; github token is not (excluded from subset).
        const gh = "ghp_" + "a".repeat(36);
        const out = filter.filter(`npm_${"e".repeat(36)} ${gh}`);
        expect(out).toBe(`XX ${gh}`);
    });
});

describe("filterSecretsFromObject", () => {
    test("redacts strings in nested objects and arrays, keeps other types", () => {
        const token = "ghp_" + "a".repeat(36);
        const input = {
            model: "gpt",
            count: 7,
            ok: true,
            nothing: null,
            messages: [
                { role: "user", content: `here is ${token}` },
                { role: "system", content: "no secrets" },
            ],
        };
        const out = filterSecretsFromObject(input);
        expect(out.messages[0].content).toBe(`here is ${R}`);
        expect(out.messages[1].content).toBe("no secrets");
        expect(out.count).toBe(7);
        expect(out.ok).toBe(true);
        expect(out.nothing).toBeNull();
    });

    test("returns a new object and does not mutate the input", () => {
        const token = "npm_" + "b".repeat(36);
        const input = { secret: token };
        const out = filterSecretsFromObject(input);
        expect(out).not.toBe(input);
        expect(input.secret).toBe(token); // original untouched
        expect(out.secret).toBe(R);
    });

    test("leaves non-plain objects (Date) untouched", () => {
        const d = new Date(0);
        const out = filterSecretsFromObject({ when: d });
        expect(out.when).toBe(d);
    });

    test("passes through non-object primitives", () => {
        expect(filterSecretsFromObject(42 as unknown)).toBe(42);
        expect(filterSecretsFromObject(null as unknown)).toBeNull();
        expect(filterSecretsFromObject("Bearer abcdef0123456789")).toBe(
            `Bearer ${R}`,
        );
    });
});

describe("filterSecretsFromJsonString", () => {
    test("keeps JSON valid and redacts string values", () => {
        const token = "ghp_" + "c".repeat(36);
        const json = JSON.stringify({
            model: "gpt",
            messages: [{ role: "user", content: `key ${token}` }],
        });
        const out = filterSecretsFromJsonString(json);
        const parsed = JSON.parse(out); // must still parse
        expect(parsed.messages[0].content).toBe(`key ${R}`);
        expect(parsed.model).toBe("gpt");
    });

    test("does not corrupt a JSON value that itself looks like an assignment", () => {
        // Raw-string redaction would strip the surrounding quotes here; the
        // JSON-aware path must keep the document parseable.
        const json = JSON.stringify({ password: "hunter2secret" });
        const out = filterSecretsFromJsonString(json);
        expect(() => JSON.parse(out)).not.toThrow();
    });

    test("falls back to raw-text redaction for non-JSON input", () => {
        const out = filterSecretsFromJsonString("password=hunter2secret");
        expect(out).toBe(`password=${R}`);
    });

    test("returns empty string unchanged", () => {
        expect(filterSecretsFromJsonString("")).toBe("");
    });
});

describe("skipValue option", () => {
    const skipDataUrl = (s: string) => /^data:[^,]*;base64,/.test(s);

    test("filterSecrets leaves a skipped string untouched", () => {
        const dataUrl = "data:image/png;base64,AKIAIOSFODNN7EXAMPLE+abc/def==";
        expect(filterSecrets(dataUrl, { skipValue: skipDataUrl })).toBe(
            dataUrl,
        );
        // Without the predicate the coincidental AKIA match would be redacted.
        expect(filterSecrets(dataUrl)).not.toBe(dataUrl);
    });

    test("walk skips base64 image data URLs but still redacts siblings", () => {
        const token = "ghp_" + "a".repeat(36);
        const dataUrl = "data:image/png;base64,AKIAIOSFODNN7EXAMPLE+abc/def==";
        const body = JSON.stringify({
            messages: [
                {
                    content: [
                        { type: "text", text: `key ${token}` },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                },
            ],
        });
        const out = filterSecretsFromJsonString(body, {
            skipValue: skipDataUrl,
        });
        const parsed = JSON.parse(out);
        // Image left intact, text secret still redacted.
        expect(parsed.messages[0].content[1].image_url.url).toBe(dataUrl);
        expect(parsed.messages[0].content[0].text).toBe(`key ${R}`);
    });
});
