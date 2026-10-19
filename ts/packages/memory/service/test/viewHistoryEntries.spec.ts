import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import git from "isomorphic-git";
import { ViewHistory } from "../src/viewHistory.js";

test("history commits preserve unchanged blobs, updates, removals and old snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "view-entries-"));
    try {
        const history = new ViewHistory(directory, () => ({ version: 0 }));
        const options = {
            fs,
            gitdir: path.join(directory, "view-history.git"),
        };
        const first = await history.commit(
            null,
            { version: 1 },
            { "keep.md": "Keep", "change.md": "Old", "remove.md": "Remove" },
            "test",
            "first",
        );
        const second = await history.commit(
            first,
            { version: 2 },
            { "keep.md": "Keep", "change.md": "New", "add.md": "Added" },
            "test",
            "second",
        );
        const previous = (await git.readTree({ ...options, oid: first })).tree;
        const current = (await git.readTree({ ...options, oid: second })).tree;
        expect(current.find((entry) => entry.path === "keep.md")).toEqual(
            previous.find((entry) => entry.path === "keep.md"),
        );
        expect(current.map((entry) => entry.path).sort()).toEqual([
            "add.md",
            "change.md",
            "keep.md",
            "state.json",
        ]);
        const changed = await git.readBlob({
            ...options,
            oid: second,
            filepath: "change.md",
        });
        expect(Buffer.from(changed.blob).toString("utf8")).toBe("New");
        expect((await history.read(first)).state).toEqual({ version: 1 });
        expect((await history.read()).state).toEqual({ version: 2 });
        await expect(
            history.commit(first, { version: 3 }, {}, "test", "stale"),
        ).rejects.toThrow("head conflict");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
