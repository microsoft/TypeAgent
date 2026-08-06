// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createSecretFilter, type SecretFilter } from "@typeagent/common-utils";

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
            nested: { value: "safe" },
            secret: "sk-proj-abcdefghijklmnopqrstuvwxyz",
        };

        const result = redactObject(input);

        expect(result.count).toBe(3);
        expect(result.enabled).toBe(true);
        expect(result.nested).not.toBe(input.nested);
        expect(result.nested.value).toBe("safe");
        expect(input.secret).toBe("sk-proj-abcdefghijklmnopqrstuvwxyz");
    });

    it("redacts structured values using a provided SecretFilter", () => {
        const baseFilter = createSecretFilter({
            initialValues: ["super-secret-value"],
        });
        let filterCalls = 0;
        const secretFilter: SecretFilter = {
            addValue: (value) => baseFilter.addValue(value),
            addValues: (values) => baseFilter.addValues(values),
            filter: (text) => {
                filterCalls++;
                return baseFilter.filter(text);
            },
            get size() {
                return baseFilter.size;
            },
        };

        const result = redactObject(
            {
                nested: { value: "super-secret-value" },
                list: ["safe", "super-secret-value"],
            },
            { secretFilter },
        );

        expect(result.nested.value).not.toContain("super-secret-value");
        expect(result.list[1]).not.toContain("super-secret-value");
        expect(filterCalls).toBe(1);
    });

    it("returns values without strings unchanged", () => {
        expect(redactObject(undefined)).toBeUndefined();
    });

    it("preserves start-of-string matching for nested password flags", () => {
        const result = redactObject({
            first: "safe",
            second: "--password hunter2secret",
        });

        expect(result.second).not.toContain("hunter2secret");
    });
});
