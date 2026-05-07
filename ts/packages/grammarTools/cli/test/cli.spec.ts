// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, "..", "cli.js");

function run(
    args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
        execFile("node", [CLI, ...args], (error, stdout, stderr) => {
            resolve({
                stdout,
                stderr,
                code: error ? ((error as any).code ?? 1) : 0,
            });
        });
    });
}

describe("grammar-tools CLI", () => {
    let tmpDir: string;
    let validFile: string;
    let invalidFile: string;

    beforeAll(() => {
        tmpDir = mkdtempSync(join(tmpdir(), "grammar-tools-test-"));
        validFile = join(tmpDir, "test.agr");
        writeFileSync(
            validFile,
            `<Start> = play $(song:string) -> { action: "play", song };\n<Start> = pause -> { action: "pause" };\n`,
        );
        invalidFile = join(tmpDir, "bad.agr");
        writeFileSync(invalidFile, "this is not valid <<<");
    });

    afterAll(() => {
        try {
            unlinkSync(validFile);
            unlinkSync(invalidFile);
        } catch {
            // ignore cleanup errors
        }
    });

    // ---------------------------------------------------------------
    // help
    // ---------------------------------------------------------------

    it("shows usage on help", async () => {
        const { stdout, code } = await run(["help"]);
        expect(code).toBe(0);
        expect(stdout).toContain("grammar-tools");
        expect(stdout).toContain("Usage:");
    });

    it("shows usage with no args", async () => {
        const { stdout, code } = await run([]);
        expect(code).toBe(0);
        expect(stdout).toContain("Usage:");
    });

    // ---------------------------------------------------------------
    // load
    // ---------------------------------------------------------------

    it("load: succeeds on valid grammar", async () => {
        const { stdout, code } = await run(["load", validFile]);
        expect(code).toBe(0);
        expect(stdout).toContain("Loaded:");
        expect(stdout).toContain("rules");
    });

    it("load --json: returns JSON with ok:true", async () => {
        const { stdout, code } = await run(["load", validFile, "--json"]);
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(true);
        expect(result.rules).toBeGreaterThan(0);
    });

    it("load: fails on invalid grammar", async () => {
        const { code } = await run(["load", invalidFile]);
        expect(code).not.toBe(0);
    });

    it("load --json: returns JSON with ok:false for invalid grammar", async () => {
        const { stdout, code } = await run(["load", invalidFile, "--json"]);
        expect(code).not.toBe(0);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toBeDefined();
    });

    it("load: fails with missing file", async () => {
        const { code } = await run(["load", "/tmp/no-such-file.agr"]);
        expect(code).not.toBe(0);
    });

    it("load: errors on missing file arg", async () => {
        const { stderr, code } = await run(["load"]);
        expect(code).not.toBe(0);
        expect(stderr).toContain("file path required");
    });

    // ---------------------------------------------------------------
    // complete
    // ---------------------------------------------------------------

    it("complete: returns completions", async () => {
        const { stdout, code } = await run(["complete", validFile, "pla"]);
        expect(code).toBe(0);
        expect(stdout.trim().length).toBeGreaterThan(0);
    });

    it("complete --json: returns JSON", async () => {
        const { stdout, code } = await run([
            "complete",
            validFile,
            "pla",
            "--json",
        ]);
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.groups).toBeDefined();
    });

    it("complete: errors on missing args", async () => {
        const { code } = await run(["complete"]);
        expect(code).not.toBe(0);
    });

    // ---------------------------------------------------------------
    // format
    // ---------------------------------------------------------------

    it("format: outputs formatted grammar", async () => {
        const { stdout, code } = await run(["format", validFile]);
        expect(code).toBe(0);
        expect(stdout).toContain("Start");
    });

    it("format --json: returns JSON with formatted field", async () => {
        const { stdout, code } = await run(["format", validFile, "--json"]);
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.formatted).toBeDefined();
    });

    it("format: errors on missing file", async () => {
        const { code } = await run(["format", "/tmp/no-such-file.agr"]);
        expect(code).not.toBe(0);
    });

    it("format --json: returns JSON error on missing file", async () => {
        const { stdout, code } = await run([
            "format",
            "/tmp/no-such-file.agr",
            "--json",
        ]);
        expect(code).not.toBe(0);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });

    it("format: errors on missing file arg", async () => {
        const { stderr, code } = await run(["format"]);
        expect(code).not.toBe(0);
        expect(stderr).toContain("file path required");
    });

    // ---------------------------------------------------------------
    // trace
    // ---------------------------------------------------------------

    it("trace: outputs formatted trace", async () => {
        const { stdout, code } = await run(["trace", validFile, "pause"]);
        expect(code).toBe(0);
        expect(stdout).toContain("matched");
    });

    it("trace --json: returns JSON with events", async () => {
        const { stdout, code } = await run([
            "trace",
            validFile,
            "pause",
            "--json",
        ]);
        expect(code).toBe(0);
        const result = JSON.parse(stdout);
        expect(result.input).toBe("pause");
        expect(result.result).toBe("matched");
        expect(result.events).toBeInstanceOf(Array);
        expect(result.events.length).toBeGreaterThan(0);
    });

    it("trace: errors on missing args", async () => {
        const { code } = await run(["trace"]);
        expect(code).not.toBe(0);
    });

    it("trace --json: returns ok:false for invalid grammar", async () => {
        const { stdout, code } = await run([
            "trace",
            invalidFile,
            "test",
            "--json",
        ]);
        expect(code).not.toBe(0);
        const result = JSON.parse(stdout);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toBeDefined();
    });

    // ---------------------------------------------------------------
    // unknown command
    // ---------------------------------------------------------------

    it("errors on unknown command", async () => {
        const { stderr, code } = await run(["bogus"]);
        expect(code).not.toBe(0);
        expect(stderr).toContain("Unknown command");
    });
});
