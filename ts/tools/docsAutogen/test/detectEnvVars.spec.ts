// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectEnvVarsFromText, detectEnvVars } from "../src/detectEnvVars.js";
import type { SourceFile } from "../src/packageInputs.js";

describe("collectEnvVarsFromText", () => {
    it("extracts dotted process.env references", () => {
        const out = [
            ...collectEnvVarsFromText(
                `const k = process.env.DISCORD_BOT_TOKEN;\nconst e = process.env.OPENAI_API_KEY;`,
            ),
        ];
        expect(out.sort()).toEqual(["DISCORD_BOT_TOKEN", "OPENAI_API_KEY"]);
    });

    it("extracts bracket-string process.env references in all quote styles", () => {
        const out = [
            ...collectEnvVarsFromText(`
                const a = process.env["AZURE_OPENAI_ENDPOINT"];
                const b = process.env['AZURE_OPENAI_API_KEY'];
                const c = process.env[\`MS_GRAPH_CLIENT_SECRET\`];
            `),
        ];
        expect(out.sort()).toEqual([
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_ENDPOINT",
            "MS_GRAPH_CLIENT_SECRET",
        ]);
    });

    it("filters out common system / runtime env vars", () => {
        const out = [
            ...collectEnvVarsFromText(`
                if (process.env.NODE_ENV === "production") {}
                const dbg = process.env.DEBUG;
                const home = process.env.HOME;
                const tmp = process.env["TEMP"];
                const ci = process.env.CI;
                const real = process.env.PROJECT_API_KEY;
            `),
        ];
        expect(out).toEqual(["PROJECT_API_KEY"]);
    });

    it("ignores lowercase identifiers (likely property reads, not env vars)", () => {
        // `process.env.someThing` is unusual but happens in test mocks where
        // someone aliases process.env. Be conservative.
        const out = [
            ...collectEnvVarsFromText(`
                const x = process.env.someProp;
                const y = process.env.MY_REAL_VAR;
                const z = process.env.A;  // single-letter, ignored
            `),
        ];
        expect(out).toEqual(["MY_REAL_VAR"]);
    });

    it("dedupes repeated references across the same text", () => {
        const out = [
            ...collectEnvVarsFromText(`
                const a = process.env.MY_KEY;
                if (process.env.MY_KEY) {}
                process.env["MY_KEY"];
            `),
        ];
        expect(out).toEqual(["MY_KEY"]);
    });

    it("returns empty for text with no process.env references", () => {
        const out = [...collectEnvVarsFromText("const x = 1;\nconst y = 2;")];
        expect(out).toEqual([]);
    });
});

describe("detectEnvVars", () => {
    let tmpRoot: string;
    beforeEach(() => {
        tmpRoot = mkdtempSync(path.join(tmpdir(), "envvars-"));
    });
    afterEach(() => {
        rmSync(tmpRoot, { recursive: true, force: true });
    });

    function writeSrc(rel: string, body: string): SourceFile {
        const abs = path.join(tmpRoot, rel.replace(/^\.\//, ""));
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body, "utf8");
        return {
            relPath: rel,
            absPath: abs,
            sizeBytes: Buffer.byteLength(body, "utf8"),
            lineCount: body.split("\n").length,
        };
    }

    it("scans all source files in the package and returns the sorted union", async () => {
        const files = [
            writeSrc(
                "./src/handler.ts",
                'const t = process.env.DISCORD_BOT_TOKEN;\nconst x = process.env["GUILD_ID"];',
            ),
            writeSrc(
                "./src/util.ts",
                "const k = process.env.DISCORD_BOT_TOKEN;",
            ),
        ];
        const out = await detectEnvVars(files);
        expect(out).toEqual(["DISCORD_BOT_TOKEN", "GUILD_ID"]);
    });

    it("skips test, spec, fixture, and mock files", async () => {
        const files = [
            writeSrc("./src/handler.ts", "const k = process.env.REAL_KEY;"),
            writeSrc(
                "./src/handler.spec.ts",
                "const k = process.env.SPEC_KEY;",
            ),
            writeSrc("./src/foo.test.ts", "const k = process.env.TEST_KEY;"),
            writeSrc(
                "./src/__tests__/x.ts",
                "const k = process.env.TESTS_DIR_KEY;",
            ),
            writeSrc(
                "./src/fixtures/y.ts",
                "const k = process.env.FIXTURE_KEY;",
            ),
            writeSrc("./src/mocks/z.ts", "const k = process.env.MOCK_KEY;"),
        ];
        const out = await detectEnvVars(files);
        expect(out).toEqual(["REAL_KEY"]);
    });

    it("returns an empty array when no source files have env vars", async () => {
        const files = [
            writeSrc("./src/a.ts", "export const x = 1;"),
            writeSrc("./src/b.ts", "export function f() { return 2; }"),
        ];
        const out = await detectEnvVars(files);
        expect(out).toEqual([]);
    });

    it("tolerates unreadable files without failing the run", async () => {
        const ok = writeSrc(
            "./src/handler.ts",
            "const k = process.env.REAL_KEY;",
        );
        const broken: SourceFile = {
            relPath: "./src/missing.ts",
            absPath: path.join(tmpRoot, "src", "does-not-exist.ts"),
            sizeBytes: 0,
            lineCount: 0,
        };
        const out = await detectEnvVars([ok, broken]);
        expect(out).toEqual(["REAL_KEY"]);
    });
});
