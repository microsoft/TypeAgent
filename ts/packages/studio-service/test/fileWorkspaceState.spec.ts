// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    FileWorkspaceState,
    studioWorkspaceStateFile,
} from "../src/fileWorkspaceState.js";

describe("FileWorkspaceState", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(os.tmpdir(), "studio-ws-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("derives distinct per-repo-root files", () => {
        const a = studioWorkspaceStateFile(dir, "/repo/a");
        const b = studioWorkspaceStateFile(dir, "/repo/b");
        expect(a).not.toBe(b);
        expect(path.dirname(a)).toBe(dir);
    });

    it("persists values across instances (durable)", async () => {
        const file = studioWorkspaceStateFile(dir, "/repo/ts");
        const first = new FileWorkspaceState(file);
        expect(first.get("sandboxes")).toBeUndefined();
        await first.update("sandboxes", [{ id: "studio-default" }]);
        await first.update("count", 2);

        // A fresh instance (mimicking an agent-server restart) sees the writes.
        const second = new FileWorkspaceState(file);
        expect(second.get("sandboxes")).toEqual([{ id: "studio-default" }]);
        expect(second.get<number>("count")).toBe(2);
    });

    it("starts empty when the file is missing or malformed", () => {
        const missing = new FileWorkspaceState(
            studioWorkspaceStateFile(dir, "/nope"),
        );
        expect(missing.get("anything")).toBeUndefined();
    });

    it("serializes concurrent updates without corrupting the file", async () => {
        const file = studioWorkspaceStateFile(dir, "/repo/concurrent");
        const ws = new FileWorkspaceState(file);
        await Promise.all([
            ws.update("a", 1),
            ws.update("b", 2),
            ws.update("c", 3),
        ]);
        const reloaded = new FileWorkspaceState(file);
        expect(reloaded.get("a")).toBe(1);
        expect(reloaded.get("b")).toBe(2);
        expect(reloaded.get("c")).toBe(3);
    });
});
