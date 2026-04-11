// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "path";
import fs from "node:fs";
import { chunkifyTypeScriptFiles } from "../src/typescriptChunker.js";

const tmpDir = path.join(os.tmpdir(), "spelunker-ts-test");

beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
});

describe("typescriptChunker.chunkifyTypeScriptFiles", () => {
    test("returns a ChunkedFile for a simple TypeScript file with a function", async () => {
        const tsFile = path.join(tmpDir, "simple.ts");
        fs.writeFileSync(
            tsFile,
            `function greet(name: string): string {
  return "Hello, " + name;
}
`,
        );

        const results = await chunkifyTypeScriptFiles([tsFile]);
        expect(results).toHaveLength(1);
        const result = results[0];
        expect("error" in result).toBe(false);
        if (!("error" in result)) {
            expect(result.fileName).toBe(tsFile);
            expect(result.chunks.length).toBeGreaterThan(0);
            // Root chunk is the file itself
            const root = result.chunks[0];
            expect(root.treeName).toBe("file");
            // There should be a child chunk for the function
            const funcChunk = result.chunks.find(
                (c) => c.treeName === "FunctionDeclaration",
            );
            expect(funcChunk).toBeDefined();
            expect(funcChunk!.codeName).toBe("greet");
        }
    });

    test("returns a ChunkedFile with blobs covering the function lines", async () => {
        const tsFile = path.join(tmpDir, "multiline.ts");
        fs.writeFileSync(
            tsFile,
            `// preamble
function add(a: number, b: number): number {
    return a + b;
}

function subtract(a: number, b: number): number {
    return a - b;
}
`,
        );

        const results = await chunkifyTypeScriptFiles([tsFile]);
        expect(results).toHaveLength(1);
        if (!("error" in results[0])) {
            const chunks = results[0].chunks;
            const funcChunks = chunks.filter(
                (c) => c.treeName === "FunctionDeclaration",
            );
            expect(funcChunks).toHaveLength(2);
            const names = funcChunks.map((c) => c.codeName).sort();
            expect(names).toEqual(["add", "subtract"]);
        }
    });

    test("returns empty chunks for a file with no declarations", async () => {
        const tsFile = path.join(tmpDir, "empty.ts");
        fs.writeFileSync(tsFile, `// just a comment\n`);

        const results = await chunkifyTypeScriptFiles([tsFile]);
        expect(results).toHaveLength(1);
        if (!("error" in results[0])) {
            // Only the root "file" chunk
            expect(results[0].chunks).toHaveLength(1);
            expect(results[0].chunks[0].treeName).toBe("file");
        }
    });
});
