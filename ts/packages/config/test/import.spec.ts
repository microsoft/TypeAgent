// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    flatEnvToConfigTree,
    importDotEnv,
    parseDotEnvText,
    writeConfigYamlFile,
} from "../src/import.js";
import { flatten } from "../src/flatten.js";

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-import-"));
}

describe("parseDotEnvText", () => {
    test("parses simple key=value pairs", () => {
        const flat = parseDotEnvText(
            ["A=1", "B=hello", "# comment", "C=value with spaces"].join("\n"),
        );
        expect(flat).toEqual({
            A: "1",
            B: "hello",
            C: "value with spaces",
        });
    });

    test("strips quotes per dotenv conventions", () => {
        const flat = parseDotEnvText(`A="quoted"\nB='single'\n`);
        expect(flat.A).toBe("quoted");
        expect(flat.B).toBe("single");
    });
});

describe("flatEnvToConfigTree", () => {
    test("places everything under extra:", () => {
        const tree = flatEnvToConfigTree({
            AZURE_OPENAI_ENDPOINT: "https://x",
            BING_API_KEY: "xyz",
        });
        expect(tree).toEqual({
            extra: {
                AZURE_OPENAI_ENDPOINT: "https://x",
                BING_API_KEY: "xyz",
            },
        });
    });

    test("returns empty tree for empty input", () => {
        expect(flatEnvToConfigTree({})).toEqual({});
    });

    test("output round-trips through flatten", () => {
        const flat = {
            AZURE_OPENAI_API_KEY: "secret",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus",
            OPENAI_MAX_CONCURRENCY: "32",
        };
        const tree = flatEnvToConfigTree(flat);
        expect(flatten(tree)).toEqual(flat);
    });
});

describe("importDotEnv", () => {
    test("end-to-end: file → tree → verified round-trip", () => {
        const dir = makeTempDir();
        try {
            const envPath = path.join(dir, ".env");
            fs.writeFileSync(
                envPath,
                [
                    "# leading comment",
                    "AZURE_OPENAI_API_KEY=sk-test",
                    "AZURE_OPENAI_ENDPOINT=https://kv.example",
                    "OPENAI_MAX_CONCURRENCY=8",
                    "BING_API_KEY=identity",
                    "",
                ].join("\n"),
            );
            const result = importDotEnv(envPath);
            expect(result.counts.total).toBe(4);
            expect(result.counts.extras).toBe(3);
            expect(result.counts.structured).toBe(1);
            expect(result.intentionalRewrites).toEqual([]);
            // Round-trip is the contract.
            expect(result.roundTrip.AZURE_OPENAI_API_KEY).toBe("sk-test");
            expect(result.roundTrip.OPENAI_MAX_CONCURRENCY).toBe("8");
            expect(result.roundTrip.BING_API_KEY).toBe("identity");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("throws on missing file", () => {
        expect(() => importDotEnv("/no/such/.env")).toThrow();
    });
});

describe("writeConfigYamlFile", () => {
    test("writes sorted YAML and creates parent directories", () => {
        const dir = makeTempDir();
        try {
            const target = path.join(dir, "nested", "out.yaml");
            writeConfigYamlFile(
                target,
                { extra: { B: "2", A: "1" } },
                "# header line\n",
            );
            const text = fs.readFileSync(target, "utf8");
            expect(text.startsWith("# header line\n")).toBe(true);
            // sortKeys: true means A appears before B inside extras.
            expect(text.indexOf("A:")).toBeLessThan(text.indexOf("B:"));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
