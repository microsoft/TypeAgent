// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * wfc integration tests.
 *
 * Spawns the compiled wfc binary as a child process and verifies behavior
 * against real .wf files from the workflow-dsl examples folder.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WFC = resolve(__dirname, "../wfc.js");
const DSL_EXAMPLES = resolve(__dirname, "../../../workflows/dsl");

interface CliResult {
    stdout: string;
    stderr: string;
    code: number;
}

function runWfc(args: string[]): Promise<CliResult> {
    return new Promise((resolveP) => {
        execFile(
            "node",
            [WFC, ...args],
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
    });
}

describe("wfc CLI", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "wfc-test-"));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    test("compiles d1-standup-prep.wf to JSON with default output path", async () => {
        const src = resolve(DSL_EXAMPLES, "d1-standup-prep.wf");
        const input = join(tmp, "d1-standup-prep.wf");
        writeFileSync(input, readFileSync(src, "utf8"), "utf8");

        const result = await runWfc([input]);
        expect(result.code).toBe(0);
        expect(result.stderr).toMatch(/\[wfc\] wrote /);

        const out = join(tmp, "d1-standup-prep.json");
        const ir = JSON.parse(readFileSync(out, "utf8"));
        expect(typeof ir).toBe("object");
        expect(ir).not.toBeNull();
        expect(ir.kind).toBe("workflow");
        expect(typeof ir.nodes).toBe("object");
        expect(Object.keys(ir.nodes).length).toBeGreaterThan(0);
    });

    test("writes IR to stdout when -o - is used", async () => {
        const src = resolve(DSL_EXAMPLES, "d1-standup-prep.wf");
        const result = await runWfc([src, "-o", "-"]);
        expect(result.code).toBe(0);
        const ir = JSON.parse(result.stdout);
        expect(ir.kind).toBe("workflow");
        expect(typeof ir.nodes).toBe("object");
    });

    test("reports parse errors with file:line:col [phase] format and exits 1", async () => {
        const input = join(tmp, "bad.wf");
        writeFileSync(input, "workflow broken( {\n", "utf8");

        const result = await runWfc([input]);
        expect(result.code).toBe(1);
        // Path may be absolute or as-passed; either way it should match the input.
        expect(result.stderr).toMatch(/bad\.wf:\d+:\d+ \[(lex|parse)\] /);
        expect(result.stderr).toMatch(/\d+ error/);
    });

    test("reports missing input file as failure", async () => {
        const result = await runWfc([join(tmp, "does-not-exist.wf")]);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/Cannot read file/);
    });

    test("prints usage and exits 1 when no input is given", async () => {
        const result = await runWfc([]);
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(/Usage:/);
    });

    test("--help prints usage and exits 0", async () => {
        const result = await runWfc(["--help"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/Usage:/);
    });

    test("--version prints version and exits 0", async () => {
        const result = await runWfc(["--version"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toMatch(/^wfc \d+\.\d+\.\d+/);
    });

    test("--compact emits minified JSON", async () => {
        const src = resolve(DSL_EXAMPLES, "d1-standup-prep.wf");
        const out = join(tmp, "min.json");
        const result = await runWfc([src, "--compact", "-o", out]);
        expect(result.code).toBe(0);
        const body = readFileSync(out, "utf8").trimEnd();
        // Minified JSON has no newlines inside the object body.
        expect(body.includes("\n")).toBe(false);
        expect(() => JSON.parse(body)).not.toThrow();
    });
});
