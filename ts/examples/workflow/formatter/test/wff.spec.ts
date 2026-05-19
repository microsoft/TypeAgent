// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * wff integration tests.
 *
 * Spawns the compiled wff binary as a child process and exercises the major
 * modes against real .wf files from workflow-dsl/examples.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WFF = resolve(__dirname, "../wff.js");
const DSL_EXAMPLES = resolve(__dirname, "../../../dsl/examples");

interface CliResult {
    stdout: string;
    stderr: string;
    code: number;
}

function runWff(args: string[], stdin?: string): Promise<CliResult> {
    return new Promise((resolveP) => {
        const child = execFile(
            "node",
            [WFF, ...args],
            { timeout: 30_000, maxBuffer: 1024 * 1024 },
            (err, stdout, stderr) => {
                resolveP({
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    code:
                        err && typeof (err as any).code === "number"
                            ? ((err as any).code as number)
                            : err
                              ? 1
                              : 0,
                });
            },
        );
        if (stdin !== undefined && child.stdin) {
            child.stdin.end(stdin);
        } else if (child.stdin) {
            child.stdin.end();
        }
    });
}

describe("wff CLI", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "wff-test-"));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    test("--check on an already-formatted file exits 0", async () => {
        // Self-stable: format the source once, write it, then expect --check
        // to report no changes needed. This avoids depending on whether the
        // example file in the repo happens to be canonical.
        const src = resolve(DSL_EXAMPLES, "d1-standup-prep.wf");
        const file = join(tmp, "d1.wf");
        writeFileSync(file, readFileSync(src, "utf8"), "utf8");

        // First, normalize via in-place write.
        const writeResult = await runWff([file]);
        expect(writeResult.code).toBe(0);

        // Now --check should be clean.
        const checkResult = await runWff(["--check", file]);
        expect(checkResult.code).toBe(0);
        expect(checkResult.stderr).not.toMatch(/need formatting/);
    });

    test("--check on a deliberately ugly file exits 1 and names the file", async () => {
        // Insert weird spacing that any reasonable formatter will normalize.
        const ugly = [
            "workflow noop(  x: string  ): string {",
            "        return x;",
            "}",
            "",
        ].join("\n");
        const file = join(tmp, "ugly.wf");
        writeFileSync(file, ugly, "utf8");

        const result = await runWff(["--check", file]);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/ugly\.wf/);
        expect(result.stderr).toMatch(/need formatting/);

        // File must NOT be modified by --check.
        expect(readFileSync(file, "utf8")).toBe(ugly);
    });

    test("default in-place write rewrites the file and is idempotent", async () => {
        const ugly = "workflow id(  x: string  ): string { return x; }\n";
        const file = join(tmp, "id.wf");
        writeFileSync(file, ugly, "utf8");

        const first = await runWff([file]);
        expect(first.code).toBe(0);
        expect(first.stderr).toMatch(/formatted/);
        const afterFirst = readFileSync(file, "utf8");
        expect(afterFirst).not.toBe(ugly);

        // Second run should be a no-op (idempotent formatter).
        const second = await runWff([file]);
        expect(second.code).toBe(0);
        expect(readFileSync(file, "utf8")).toBe(afterFirst);
    });

    test("--stdout writes formatted text without modifying the file", async () => {
        const ugly = "workflow id(  x: string  ): string { return x; }\n";
        const file = join(tmp, "id.wf");
        writeFileSync(file, ugly, "utf8");

        const result = await runWff(["--stdout", file]);
        expect(result.code).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(0);
        expect(readFileSync(file, "utf8")).toBe(ugly);
    });

    test("--stdout always emits, even when input is already formatted", async () => {
        // Regression: previously --stdout returned empty when output === source.
        const src = resolve(DSL_EXAMPLES, "d1-standup-prep.wf");
        const file = join(tmp, "d1.wf");
        writeFileSync(file, readFileSync(src, "utf8"), "utf8");
        // Normalize the file first so it equals its formatted form.
        await runWff([file]);
        const normalized = readFileSync(file, "utf8");

        const result = await runWff(["--stdout", file]);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe(normalized);
    });

    test("preserves \\n escape inside template literals (round-trip)", async () => {
        // Regression: previously the formatter decoded \n to a real newline
        // because the lexer was eager-decoding template parts.
        const src =
            "workflow t(repo: string, out: string): string {\n    return `## ${repo}\\n${out}`;\n}\n";
        const result = await runWff([], src);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("`## ${repo}\\n${out}`");
        expect(result.stdout).not.toContain("`## ${repo}\n${out}`");
    });

    test("preserves real newlines inside template literals (round-trip)", async () => {
        // Regression: the inverse direction - a literal newline must stay literal.
        const src =
            "workflow t(repo: string, out: string): string {\n    return `## ${repo}\n${out}`;\n}\n";
        const result = await runWff([], src);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("`## ${repo}\n${out}`");
        expect(result.stdout).not.toContain("\\n${out}");
    });

    test("--diff prints a unified-ish diff and exits 1 when changes are needed", async () => {
        const ugly = "workflow id(  x: string  ): string { return x; }\n";
        const file = join(tmp, "id.wf");
        writeFileSync(file, ugly, "utf8");

        const result = await runWff(["--diff", file]);
        expect(result.code).toBe(1);
        expect(result.stdout).toMatch(/^--- /m);
        expect(result.stdout).toMatch(/^\+\+\+ /m);
    });

    test("stdin -> stdout pipeline", async () => {
        const ugly = "workflow id(  x: string  ): string { return x; }\n";
        const result = await runWff([], ugly);
        expect(result.code).toBe(0);
        expect(result.stdout.length).toBeGreaterThan(0);
        // Output should be valid input itself (round-trip via stdin again).
        const round = await runWff([], result.stdout);
        expect(round.code).toBe(0);
        expect(round.stdout).toBe(result.stdout);
    });

    test("reports parse errors with file:line:col [phase] format and leaves the file untouched", async () => {
        const broken = "workflow broken( {\n";
        const file = join(tmp, "bad.wf");
        writeFileSync(file, broken, "utf8");

        const result = await runWff([file]);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/bad\.wf:\d+:\d+ \[(lex|parse)\] /);
        // Original content preserved.
        expect(readFileSync(file, "utf8")).toBe(broken);
    });

    test("--check + --diff are mutually exclusive", async () => {
        const result = await runWff(["--check", "--diff", "x.wf"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toMatch(/cannot be combined/);
    });

    test("--stdout with multiple files is rejected", async () => {
        const a = join(tmp, "a.wf");
        const b = join(tmp, "b.wf");
        writeFileSync(a, "workflow a(): string { return `a`; }\n");
        writeFileSync(b, "workflow b(): string { return `b`; }\n");

        const result = await runWff(["--stdout", a, b]);
        expect(result.code).toBe(2);
        expect(result.stderr).toMatch(/--stdout/);
    });

    test("--help prints usage and exits 0", async () => {
        const result = await runWff(["--help"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/Usage:/);
    });

    test("--version prints version and exits 0", async () => {
        const result = await runWff(["--version"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/^wff \d+\.\d+\.\d+/);
    });

    test("--indent 2 produces a different result than --indent 4", async () => {
        const src = "workflow id(x: string): string {\n  return x;\n}\n";
        const r2 = await runWff(["--indent", "2"], src);
        const r4 = await runWff(["--indent", "4"], src);
        expect(r2.code).toBe(0);
        expect(r4.code).toBe(0);
        expect(r2.stdout).not.toBe(r4.stdout);
    });

    test("invalid --indent value exits 2", async () => {
        const result = await runWff(["--indent", "-1", "x.wf"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toMatch(/--indent/);
    });
});
