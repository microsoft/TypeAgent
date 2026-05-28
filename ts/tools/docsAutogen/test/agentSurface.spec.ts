// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { detectAgentSurface, hasAgentSurface } from "../src/agentSurface.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function makeFixture(files: readonly string[]): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "docs-autogen-"));
    const src = path.join(root, "src");
    await fs.mkdir(src, { recursive: true });
    for (const f of files) {
        await fs.writeFile(path.join(src, f), "", "utf8");
    }
    return root;
}

describe("detectAgentSurface", () => {
    it("recognises the canonical four files of a list-style agent", async () => {
        const dir = await makeFixture([
            "listManifest.json",
            "listSchema.ts",
            "listSchema.agr",
            "listActionHandler.ts",
        ]);
        const s = await detectAgentSurface(dir);
        expect(s.manifestPath).toBe("./src/listManifest.json");
        expect(s.schemaPath).toBe("./src/listSchema.ts");
        expect(s.grammarPath).toBe("./src/listSchema.agr");
        expect(s.handlerPath).toBe("./src/listActionHandler.ts");
        expect(hasAgentSurface(s)).toBe(true);
    });

    it("falls back to lowercase manifest.json", async () => {
        const dir = await makeFixture(["manifest.json", "fooHandler.ts"]);
        const s = await detectAgentSurface(dir);
        expect(s.manifestPath).toBe("./src/manifest.json");
        expect(s.handlerPath).toBe("./src/fooHandler.ts");
    });

    it("returns all-null when src/ does not exist", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "docs-autogen-"));
        const s = await detectAgentSurface(root);
        expect(s).toEqual({
            manifestPath: null,
            schemaPath: null,
            grammarPath: null,
            handlerPath: null,
        });
        expect(hasAgentSurface(s)).toBe(false);
    });

    it("returns all-null when src/ has no recognisable agent files", async () => {
        const dir = await makeFixture(["foo.ts", "bar.json", "baz.txt"]);
        const s = await detectAgentSurface(dir);
        expect(hasAgentSurface(s)).toBe(false);
    });
});
