// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPathSource } from "../src/installSources/pathSource.js";

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("pathSource", () => {
    it("find returns a candidate for an existing absolute path", async () => {
        const dir = tmpDir("ta-path-");
        const source = createPathSource({ kind: "path", name: "path" });
        const candidate = await source.find(dir);
        expect(candidate).toBeDefined();
        expect(candidate!.source).toBe("path");
        expect(candidate!.path).toBe(path.resolve(dir));
        // path-resolved candidates omit module (§12 Q17).
        expect(candidate!.module).toBeUndefined();
    });

    it("find returns undefined for a missing path (non-match)", async () => {
        const source = createPathSource({ kind: "path", name: "path" });
        const missing = path.join(os.tmpdir(), "ta-does-not-exist-xyz-123");
        expect(await source.find(missing)).toBeUndefined();
    });

    it("find resolves a relative ref against baseDir", async () => {
        const base = tmpDir("ta-pathbase-");
        const child = path.join(base, "agentpkg");
        fs.mkdirSync(child);
        const source = createPathSource({
            kind: "path",
            name: "path",
            baseDir: base,
        });
        const candidate = await source.find("agentpkg");
        expect(candidate).toBeDefined();
        expect(candidate!.path).toBe(path.resolve(child));
    });

    it("find returns undefined for a relative ref when no baseDir is configured", async () => {
        // Without a base, a relative ref cannot be anchored (the source may run
        // in a different process/CWD than the host app), so it is a non-match
        // and the ordered walk continues. Absolute paths still resolve.
        const source = createPathSource({ kind: "path", name: "path" });
        expect(await source.find("./agentpkg")).toBeUndefined();
        expect(await source.find("agentpkg")).toBeUndefined();
    });

    it("materialize records path + source and omits module", async () => {
        const dir = tmpDir("ta-pathmat-");
        const source = createPathSource({ kind: "path", name: "mypath" });
        const candidate = await source.find(dir);
        const record = await source.materialize(candidate!);
        expect(record.kind).toBe("npm");
        expect(record.source).toBe("mypath");
        expect(record.path).toBe(path.resolve(dir));
        expect(record.module).toBeUndefined();
        expect(record.name).toBe(path.basename(dir));
    });

    it("is not enumerable", () => {
        const source = createPathSource({ kind: "path", name: "path" });
        expect(source.listAgents).toBeUndefined();
    });
});
