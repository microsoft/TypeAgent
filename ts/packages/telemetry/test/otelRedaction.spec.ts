// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSecretFilter } from "@typeagent/common-utils";

import { redactObject, redactText } from "../src/otel/redaction.js";

describe("redactText", () => {
    it("redacts recognizable secret formats by default", () => {
        const text = "token=sk-proj-abcdefghijklmnopqrstuvwxyz";
        expect(redactText(text)).not.toContain(
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
        );
    });

    it("leaves ordinary text untouched", () => {
        expect(redactText("hello world")).toBe("hello world");
    });

    it("uses a provided SecretFilter's registered values", () => {
        const secretFilter = createSecretFilter();
        secretFilter.addValue("super-secret-value");

        expect(
            redactText("value=super-secret-value", { secretFilter }),
        ).not.toContain("super-secret-value");
        // Registered values not known to the default filter are left alone.
        expect(redactText("value=super-secret-value")).toContain(
            "super-secret-value",
        );
    });
});

describe("redactObject", () => {
    it("redacts strings anywhere in a structured value by default", () => {
        const input = {
            message: "hello",
            nested: { apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz" },
            list: ["sk-proj-abcdefghijklmnopqrstuvwxyz", "safe"],
        };

        const result = redactObject(input);

        expect(result.message).toBe("hello");
        expect(result.nested.apiKey).not.toContain(
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
        );
        expect(result.list[0]).not.toContain(
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
        );
        expect(result.list[1]).toBe("safe");
    });

    it("preserves non-string values and does not mutate the input", () => {
        const input = {
            count: 3,
            enabled: true,
            when: new Date("2024-01-01T00:00:00Z"),
            secret: "sk-proj-abcdefghijklmnopqrstuvwxyz",
        };

        const result = redactObject(input);

        expect(result.count).toBe(3);
        expect(result.enabled).toBe(true);
        expect(result.when).toBe(input.when);
        expect(input.secret).toBe("sk-proj-abcdefghijklmnopqrstuvwxyz");
    });

    it("redacts structured values using a provided SecretFilter", () => {
        const secretFilter = createSecretFilter();
        secretFilter.addValue("super-secret-value");

        const result = redactObject(
            { nested: { value: "super-secret-value" } },
            { secretFilter },
        );

        expect(result.nested.value).not.toContain("super-secret-value");
    });
});
