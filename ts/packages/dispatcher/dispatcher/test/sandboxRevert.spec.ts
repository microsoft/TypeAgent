// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    revertAllFromOriginal,
    revertSandboxFromOriginal,
    snapshotSandboxOriginal,
} from "../src/neighborhoods/optimize/sandboxRevert.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-sandbox-revert-"));
}

function writeAgent(
    sandboxDir: string,
    schemaName: string,
    files: Record<string, string>,
): void {
    const dir = path.join(sandboxDir, "agents", schemaName);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content);
    }
}

function readFile(p: string): string {
    return fs.readFileSync(p, "utf-8");
}

describe("sandboxRevert", () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("snapshots the agents subtree into .original/", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "export type AlphaAction = { actionName: 'a' };",
        });
        writeAgent(sandbox, "beta", {
            "manifest.json": '{"emojiChar":"🅱️"}',
            "schema.pas.json": '{"version":1,"entry":{},"types":{}}',
        });

        snapshotSandboxOriginal(sandbox);

        const originalAlpha = path.join(
            sandbox,
            ".original",
            "agents",
            "alpha",
        );
        const originalBeta = path.join(
            sandbox,
            ".original",
            "agents",
            "beta",
        );
        expect(fs.existsSync(path.join(originalAlpha, "manifest.json"))).toBe(
            true,
        );
        expect(fs.existsSync(path.join(originalAlpha, "schema.ts"))).toBe(true);
        expect(fs.existsSync(path.join(originalBeta, "manifest.json"))).toBe(
            true,
        );
        expect(fs.existsSync(path.join(originalBeta, "schema.pas.json"))).toBe(
            true,
        );
    });

    it("re-snapshotting overwrites existing .original/", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "v1",
        });
        snapshotSandboxOriginal(sandbox);
        // Mutate live then re-snapshot — .original/ should reflect the new
        // live state.
        fs.writeFileSync(
            path.join(sandbox, "agents", "alpha", "schema.ts"),
            "v2",
        );
        snapshotSandboxOriginal(sandbox);
        const snap = readFile(
            path.join(
                sandbox,
                ".original",
                "agents",
                "alpha",
                "schema.ts",
            ),
        );
        expect(snap).toBe("v2");
    });

    it("revertSandboxFromOriginal restores byte-identical files for one schema", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "original content",
        });
        writeAgent(sandbox, "beta", {
            "manifest.json": '{"emojiChar":"🅱️"}',
            "schema.ts": "beta content",
        });
        snapshotSandboxOriginal(sandbox);

        // Mutate alpha and beta.
        const alphaSchema = path.join(
            sandbox,
            "agents",
            "alpha",
            "schema.ts",
        );
        const betaSchema = path.join(sandbox, "agents", "beta", "schema.ts");
        fs.writeFileSync(alphaSchema, "mutated alpha");
        fs.writeFileSync(betaSchema, "mutated beta");

        revertSandboxFromOriginal("alpha", sandbox);

        // Alpha is reverted; beta is left alone (per-schema revert).
        expect(readFile(alphaSchema)).toBe("original content");
        expect(readFile(betaSchema)).toBe("mutated beta");
    });

    it("revert produces byte-identical files (preserves trailing newlines, encoding)", () => {
        // Use a content string with a mix of LF and trailing newline.
        const content =
            "line 1\nline 2 with unicode ✓\nline 3 trailing newline\n";
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": content,
        });
        snapshotSandboxOriginal(sandbox);

        const alphaSchema = path.join(
            sandbox,
            "agents",
            "alpha",
            "schema.ts",
        );
        fs.writeFileSync(alphaSchema, "completely different");
        revertSandboxFromOriginal("alpha", sandbox);

        const restored = fs.readFileSync(alphaSchema);
        const snapshot = fs.readFileSync(
            path.join(
                sandbox,
                ".original",
                "agents",
                "alpha",
                "schema.ts",
            ),
        );
        // Byte-identical comparison.
        expect(restored.equals(snapshot)).toBe(true);
    });

    it("revertSandboxFromOriginal removes files the snapshot lacks", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "original",
        });
        snapshotSandboxOriginal(sandbox);

        // Add a new file not in the snapshot.
        fs.writeFileSync(
            path.join(sandbox, "agents", "alpha", "extra.txt"),
            "leak",
        );

        revertSandboxFromOriginal("alpha", sandbox);

        expect(
            fs.existsSync(path.join(sandbox, "agents", "alpha", "extra.txt")),
        ).toBe(false);
    });

    it("revertAllFromOriginal restores every schema", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "alpha v1",
        });
        writeAgent(sandbox, "beta", {
            "manifest.json": '{"emojiChar":"🅱️"}',
            "schema.ts": "beta v1",
        });
        snapshotSandboxOriginal(sandbox);

        fs.writeFileSync(
            path.join(sandbox, "agents", "alpha", "schema.ts"),
            "alpha mutated",
        );
        fs.writeFileSync(
            path.join(sandbox, "agents", "beta", "schema.ts"),
            "beta mutated",
        );

        revertAllFromOriginal(sandbox);

        expect(
            readFile(path.join(sandbox, "agents", "alpha", "schema.ts")),
        ).toBe("alpha v1");
        expect(
            readFile(path.join(sandbox, "agents", "beta", "schema.ts")),
        ).toBe("beta v1");
    });

    it("throws when snapshot missing", () => {
        writeAgent(sandbox, "alpha", {
            "manifest.json": '{"emojiChar":"⭐"}',
            "schema.ts": "x",
        });
        // No snapshot taken.
        expect(() => revertSandboxFromOriginal("alpha", sandbox)).toThrow(
            /no snapshot/i,
        );
        expect(() => revertAllFromOriginal(sandbox)).toThrow(/no snapshot/i);
    });

    it("throws when no agents dir exists to snapshot", () => {
        // Empty sandbox directory.
        expect(() => snapshotSandboxOriginal(sandbox)).toThrow(
            /does not exist/i,
        );
    });
});
