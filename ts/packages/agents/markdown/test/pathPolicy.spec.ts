// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    resolveExistingFileWithinRoot,
    resolvePathWithinRoot,
    resolveWritableFileWithinRoot,
} from "../src/view/route/pathPolicy.js";

describe("markdown path policy", () => {
    let temporaryDirectory: string;
    let root: string;
    let sibling: string;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-path-"),
        );
        root = path.join(temporaryDirectory, "Documents");
        sibling = path.join(temporaryDirectory, "Documents-backup");
        fs.mkdirSync(root);
        fs.mkdirSync(sibling);
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test("allows paths inside the root", () => {
        expect(resolvePathWithinRoot(root, "notes/example.md")).toBe(
            path.join(fs.realpathSync(root), "notes", "example.md"),
        );
    });

    test("allows names that begin with two dots inside the root", () => {
        expect(resolvePathWithinRoot(root, "..notes.md")).toBe(
            path.join(fs.realpathSync(root), "..notes.md"),
        );
    });

    test("rejects sibling directories that share the root prefix", () => {
        expect(
            resolvePathWithinRoot(
                root,
                path.join("..", "Documents-backup", "notes.md"),
            ),
        ).toBeUndefined();
    });

    test("rejects absolute paths outside the root", () => {
        expect(
            resolvePathWithinRoot(root, path.join(sibling, "notes.md")),
        ).toBeUndefined();
    });

    test("canonicalizes and allows an existing file inside the root", () => {
        const file = path.join(root, "notes.md");
        fs.writeFileSync(file, "safe");

        expect(resolveExistingFileWithinRoot(root, "notes.md")).toBe(
            fs.realpathSync(file),
        );
    });

    test("preserves load-then-write through a root junction", () => {
        const canonicalRoot = path.join(temporaryDirectory, "Canonical");
        const linkedRoot = path.join(temporaryDirectory, "Linked");
        const file = path.join(canonicalRoot, "notes.md");
        fs.mkdirSync(canonicalRoot);
        fs.writeFileSync(file, "safe");
        fs.symlinkSync(canonicalRoot, linkedRoot, "junction");

        const loadedPath = resolveExistingFileWithinRoot(
            linkedRoot,
            "notes.md",
        );
        expect(loadedPath).toBe(fs.realpathSync(file));
        if (loadedPath === undefined) {
            throw new Error("Expected the file to resolve through the root");
        }
        expect(resolveWritableFileWithinRoot(linkedRoot, loadedPath)).toBe(
            fs.realpathSync(file),
        );
    });

    test("allows a new writable file only when its parent is inside the root", () => {
        expect(resolveWritableFileWithinRoot(root, "new.md")).toBe(
            path.join(fs.realpathSync(root), "new.md"),
        );
        expect(
            resolveWritableFileWithinRoot(
                root,
                path.join("..", "Documents-backup", "new.md"),
            ),
        ).toBeUndefined();
    });

    test("rejects a symlink that resolves outside the root", () => {
        const outsideFile = path.join(sibling, "notes.md");
        const link = path.join(root, "linked");
        fs.writeFileSync(outsideFile, "secret");
        fs.symlinkSync(sibling, link, "junction");

        expect(
            resolveExistingFileWithinRoot(
                root,
                path.join("linked", "notes.md"),
            ),
        ).toBeUndefined();
        expect(
            resolveWritableFileWithinRoot(
                root,
                path.join("linked", "notes.md"),
            ),
        ).toBeUndefined();
        expect(
            resolveWritableFileWithinRoot(root, path.join("linked", "new.md")),
        ).toBeUndefined();
    });
});
