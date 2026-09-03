// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    normalizeRelativeDocumentPath,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "../src/agent/pathPolicy.js";

describe("markdown creation path policy", () => {
    let temporaryDirectory: string;
    let root: string;
    let sibling: string;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-create-path-"),
        );
        root = path.join(temporaryDirectory, "Documents");
        sibling = path.join(temporaryDirectory, "Documents-backup");
        fs.mkdirSync(root);
        fs.mkdirSync(sibling);
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test("resolves a new file and creates nested directories inside the root", () => {
        expect(resolveWritableFileWithinRoot(root, "new.md")).toBe(
            path.join(fs.realpathSync(root), "new.md"),
        );
        expect(resolveWritableFileWithinRoot(root, "notes/nested/new.md")).toBe(
            path.join(fs.realpathSync(root), "notes", "nested", "new.md"),
        );
        expect(
            fs.statSync(path.join(root, "notes", "nested")).isDirectory(),
        ).toBe(true);
    });

    test("rejects paths outside the root", () => {
        expect(
            resolveWritableFileWithinRoot(
                root,
                path.join("..", "Documents-backup", "new.md"),
            ),
        ).toBeUndefined();
    });

    test("rejects a symlink that resolves outside the root", () => {
        const link = path.join(root, "linked");
        fs.symlinkSync(sibling, link, "junction");

        expect(
            resolveWritableFileWithinRoot(root, path.join("linked", "new.md")),
        ).toBeUndefined();
    });

    test("rejects a dangling link as a writable target", () => {
        const link = path.join(root, "dangling");
        fs.symlinkSync(path.join(sibling, "missing"), link, "junction");

        expect(resolveWritableFileWithinRoot(root, "dangling")).toBeUndefined();
    });

    test("normalizes relative document paths and rejects unsafe inputs", () => {
        expect(normalizeRelativeDocumentPath(" notes\\nested\\plan ")).toBe(
            "notes/nested/plan",
        );
        expect(normalizeRelativeDocumentPath("../escape.md")).toBeUndefined();
        expect(
            normalizeRelativeDocumentPath("sub/../escape.md"),
        ).toBeUndefined();
        expect(normalizeRelativeDocumentPath("/tmp/escape.md")).toBeUndefined();
        expect(normalizeRelativeDocumentPath("C:escape.md")).toBeUndefined();
    });

    test("accepts only existing absolute directories as workspace roots", () => {
        expect(resolveRealDirectory(root)).toBe(fs.realpathSync(root));
        expect(resolveRealDirectory("relative")).toBeUndefined();
        expect(
            resolveRealDirectory(path.join(root, "missing")),
        ).toBeUndefined();
    });
});
