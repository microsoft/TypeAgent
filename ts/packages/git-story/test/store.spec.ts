// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../src/store.js";

// Each test gets a fresh temp root; nested path checks dir creation.
let dir: string;
const resolveRoot = (kind: string) => path.join(dir, "a", kind);
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-store-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("openStore", () => {
    it("puts, gets, lists, overwrites, and deletes records", () => {
        const { repos, root } = openStore("shared", { resolveRoot });
        repos.put("r1", { gitCommonDir: "/x", registeredAt: "t1" });
        repos.put("r1", { gitCommonDir: "/y", registeredAt: "t2" });
        expect(repos.get("r1")).toEqual({
            gitCommonDir: "/y",
            registeredAt: "t2",
        });
        expect(fs.readdirSync(path.join(root, "repos"))).toEqual(["r1.json"]);
        expect(repos.list()).toEqual(["r1"]);
        repos.delete("r1");
        expect(repos.get("r1")).toBeUndefined();
    });

    it("rejects ids that escape the folder", () => {
        const { sessions } = openStore("repo", { resolveRoot });
        for (const id of ["../x", "a/b", ".hidden", ""]) {
            expect(() => sessions.get(id)).toThrow(/invalid record id/);
        }
    });

    it("refuses a newer version", () => {
        const { root } = openStore("repo", { resolveRoot });
        fs.writeFileSync(path.join(root, "version"), "99\n");
        expect(() => openStore("repo", { resolveRoot })).toThrow(/newer/);
    });
});
