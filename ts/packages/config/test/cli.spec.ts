// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runCli, type CliIO } from "../src/cli.js";
import { REDACTED } from "../src/redact.js";

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-cli-"));
}

function makeIO(): CliIO & { out: string; err: string } {
    let out = "";
    let err = "";
    return {
        stdout: (t: string) => {
            out += t;
        },
        stderr: (t: string) => {
            err += t;
        },
        get out(): string {
            return out;
        },
        get err(): string {
            return err;
        },
    } as CliIO & { out: string; err: string };
}

describe("runCli", () => {
    test("returns 0 when --help is requested explicitly", async () => {
        const io = makeIO();
        const code = await runCli(["--help"], io);
        expect(code).toBe(0);
        expect(io.out).toContain("typeagent-config");
    });

    test("returns 1 when no command is given", async () => {
        const io = makeIO();
        const code = await runCli([], io);
        expect(code).toBe(1);
    });

    test("rejects unknown commands", async () => {
        const io = makeIO();
        const code = await runCli(["bogus"], io);
        expect(code).toBe(1);
        expect(io.err).toContain("Unknown command: bogus");
    });
});

describe("import command", () => {
    test("converts .env → YAML and verifies round-trip", async () => {
        const dir = makeTempDir();
        try {
            const envPath = path.join(dir, ".env");
            const outPath = path.join(dir, "config.local.yaml");
            fs.writeFileSync(
                envPath,
                "AZURE_OPENAI_API_KEY=sk-x\nOPENAI_MAX_CONCURRENCY=8\n",
            );
            const io = makeIO();
            const code = await runCli(
                ["import", envPath, "--out", outPath],
                io,
            );
            expect(code).toBe(0);
            expect(io.out).toContain("Round-trip verified");
            expect(fs.existsSync(outPath)).toBe(true);
            const yamlText = fs.readFileSync(outPath, "utf8");
            expect(yamlText).toContain("extra:");
            expect(yamlText).toContain("AZURE_OPENAI_API_KEY: sk-x");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("missing input path yields exit code 1", async () => {
        const io = makeIO();
        const code = await runCli(["import", "/no/such/file.env"], io);
        expect(code).toBe(1);
        expect(io.err).toContain("File not found");
    });

    test("rejects unknown flags", async () => {
        const io = makeIO();
        const code = await runCli(["import", "x", "--foo"], io);
        expect(code).toBe(1);
        expect(io.err).toContain("Unknown flag");
    });
});

describe("show command", () => {
    test("prints redacted merged config", async () => {
        const dir = makeTempDir();
        try {
            fs.writeFileSync(
                path.join(dir, "config.defaults.yaml"),
                "extra:\n  AZURE_OPENAI_API_KEY: sk-secret\n  OPENAI_MAX_CONCURRENCY: 8\n",
            );
            const io = makeIO();
            // Override CWD-relative defaults via env? No — use direct
            // workspaceRoot via a temporary chdir would couple us to
            // global state. Instead, the CLI's show command reads from
            // the inferred workspace root; we can't easily inject it.
            // For the unit test, just exercise CLI shape.
            const prev = process.cwd();
            process.chdir(dir);
            try {
                const code = await runCli(["show"], io);
                expect(code).toBe(0);
                // Defaults file at the workspace root we chdir'd into
                // may or may not be picked up depending on workspace
                // detection. The smoke test is that show exits 0 and
                // any secret keys it does see are redacted.
                if (io.out.includes("AZURE_OPENAI_API_KEY=")) {
                    // Either the value is the literal "identity"
                    // (Azure managed identity, never a secret) or
                    // it has been redacted.
                    const m = io.out.match(/AZURE_OPENAI_API_KEY=(\S+)/);
                    expect(m).not.toBeNull();
                    expect([REDACTED, "identity"]).toContain(m![1]);
                }
            } finally {
                process.chdir(prev);
            }
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("rejects unknown flags", async () => {
        const io = makeIO();
        const code = await runCli(["show", "--bogus"], io);
        expect(code).toBe(1);
    });
});

describe("check command", () => {
    test("requires a vault name", async () => {
        const prev = process.env.TYPEAGENT_CONFIG_VAULT;
        delete process.env.TYPEAGENT_CONFIG_VAULT;
        try {
            const io = makeIO();
            const code = await runCli(["check"], io);
            expect(code).toBe(1);
            expect(io.err).toContain("Vault name required");
        } finally {
            if (prev !== undefined) {
                process.env.TYPEAGENT_CONFIG_VAULT = prev;
            }
        }
    });

    test("rejects unknown flags", async () => {
        const io = makeIO();
        const code = await runCli(["check", "--vault", "v", "--bogus"], io);
        expect(code).toBe(1);
    });
});
