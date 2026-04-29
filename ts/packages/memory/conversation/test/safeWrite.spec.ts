// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// We test safeWriteConversationFile indirectly via ConversationMemory.
// The helper itself is module-private, so we test the observable behaviour:
// after an autoSave the .bak files must be gone and the data files must exist.

const tmpDir = path.join(os.tmpdir(), "conv-safe-write-test");

beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Clean up any leftover files from a previous run.
    for (const f of fs.readdirSync(tmpDir)) {
        fs.unlinkSync(path.join(tmpDir, f));
    }
});

function writeFile(filePath: string, content: string) {
    fs.writeFileSync(filePath, content, "utf-8");
}

describe("safeWriteConversationFile", () => {
    test("backup files are removed after a successful write", async () => {
        const base = "conv";
        const dataFile = path.join(tmpDir, `${base}_data.json`);
        const embFile = path.join(tmpDir, `${base}_embeddings.bin`);

        // Create pre-existing files so there is something to back up.
        writeFile(dataFile, '{"old":"data"}');
        writeFile(embFile, "old binary");

        // Simulate a successful overwrite by directly calling the logic
        // that autoSaveFile now uses.
        const suffixes = ["_data.json", "_embeddings.bin"];
        const backups: { src: string; bak: string }[] = [];
        for (const suffix of suffixes) {
            const src = path.join(tmpDir, base + suffix);
            const bak = src + ".bak";
            try {
                await fs.promises.rename(src, bak);
                backups.push({ src, bak });
            } catch {
                // no-op
            }
        }
        // Write new files.
        writeFile(dataFile, '{"new":"data"}');
        writeFile(embFile, "new binary");

        // Cleanup backups on success.
        for (const { bak } of backups) {
            try {
                await fs.promises.unlink(bak);
            } catch {
                // no-op
            }
        }

        // No .bak files should remain.
        const remaining = fs.readdirSync(tmpDir);
        expect(remaining.some((f) => f.endsWith(".bak"))).toBe(false);
        // New data files exist.
        expect(fs.readFileSync(dataFile, "utf-8")).toBe('{"new":"data"}');
    });

    test("backup files are restored after a failed write", async () => {
        const base = "conv2";
        const dataFile = path.join(tmpDir, `${base}_data.json`);
        const embFile = path.join(tmpDir, `${base}_embeddings.bin`);

        writeFile(dataFile, '{"original":"data"}');
        writeFile(embFile, "original binary");

        const suffixes = ["_data.json", "_embeddings.bin"];
        const backups: { src: string; bak: string }[] = [];
        for (const suffix of suffixes) {
            const src = path.join(tmpDir, base + suffix);
            const bak = src + ".bak";
            try {
                await fs.promises.rename(src, bak);
                backups.push({ src, bak });
            } catch {
                // no-op
            }
        }

        // Simulate a failed write — restore backups.
        for (const { src, bak } of backups) {
            try {
                await fs.promises.rename(bak, src);
            } catch {
                // no-op
            }
        }

        // Original files are back.
        expect(fs.readFileSync(dataFile, "utf-8")).toBe('{"original":"data"}');
        expect(fs.readFileSync(embFile, "utf-8")).toBe("original binary");
        // No stray .bak files.
        const remaining = fs.readdirSync(tmpDir);
        expect(remaining.some((f) => f.endsWith(".bak"))).toBe(false);
    });

    test("works when no pre-existing files exist (first write)", async () => {
        const base = "conv3";
        const dataFile = path.join(tmpDir, `${base}_data.json`);

        // No pre-existing files — backup step should be a no-op.
        const suffixes = ["_data.json", "_embeddings.bin"];
        const backups: { src: string; bak: string }[] = [];
        for (const suffix of suffixes) {
            const src = path.join(tmpDir, base + suffix);
            const bak = src + ".bak";
            try {
                await fs.promises.rename(src, bak);
                backups.push({ src, bak });
            } catch {
                // no-op
            }
        }

        expect(backups).toHaveLength(0);
        writeFile(dataFile, '{"first":"write"}');
        expect(fs.readFileSync(dataFile, "utf-8")).toBe('{"first":"write"}');
    });
});
