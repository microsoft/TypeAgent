// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    ensureDirectoryWithinRoot,
    isCanonicalDirectory,
    normalizeRelativeDocumentPath,
    resolveExistingFileWithinRoot,
    resolvePathWithinRoot,
    resolveRealDirectory,
    resolveWritableFileWithinRoot,
} from "../src/agent/pathPolicy.js";

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
        expect(resolvePathWithinRoot(root, ".")).toBe(fs.realpathSync(root));
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

    test("rejects a dangling link as a writable target", () => {
        const link = path.join(root, "dangling");
        fs.symlinkSync(path.join(sibling, "missing"), link, "junction");

        expect(resolveWritableFileWithinRoot(root, "dangling")).toBeUndefined();
    });

    test("creates nested subdirectories when createSubdirs is set", () => {
        const target = resolveWritableFileWithinRoot(
            root,
            path.join("sub", "deeper", "note.md"),
            { createSubdirs: true },
        );
        expect(target).toBe(
            path.join(fs.realpathSync(root), "sub", "deeper", "note.md"),
        );
        expect(fs.existsSync(path.join(root, "sub", "deeper"))).toBe(true);
    });

    test("ensureDirectoryWithinRoot refuses a symlink mid-walk", () => {
        const linked = path.join(root, "linked");
        fs.symlinkSync(sibling, linked, "junction");
        expect(
            ensureDirectoryWithinRoot(root, path.join("linked", "child")),
        ).toBeUndefined();
    });

    test("normalizeRelativeDocumentPath accepts a plain relative name", () => {
        expect(normalizeRelativeDocumentPath("notes/first.md")).toBe(
            "notes/first.md",
        );
        expect(normalizeRelativeDocumentPath("notes\\second.md")).toBe(
            "notes/second.md",
        );
    });

    test("normalizeRelativeDocumentPath rejects unsafe inputs", () => {
        expect(normalizeRelativeDocumentPath("")).toBeUndefined();
        expect(normalizeRelativeDocumentPath("   ")).toBeUndefined();
        expect(normalizeRelativeDocumentPath(undefined)).toBeUndefined();
        expect(normalizeRelativeDocumentPath(123)).toBeUndefined();
        expect(normalizeRelativeDocumentPath("../escape.md")).toBeUndefined();
        expect(
            normalizeRelativeDocumentPath("sub/../escape.md"),
        ).toBeUndefined();
        expect(normalizeRelativeDocumentPath("./x.md")).toBeUndefined();
        expect(normalizeRelativeDocumentPath("C:foo.md")).toBeUndefined();
        // Absolute paths are rejected on POSIX and Windows alike.
        expect(normalizeRelativeDocumentPath("/etc/passwd.md")).toBeUndefined();
    });

    test("resolveRealDirectory accepts existing absolute directories", () => {
        expect(resolveRealDirectory(root)).toBe(fs.realpathSync(root));
        expect(isCanonicalDirectory(root)).toBe(true);
        expect(resolveRealDirectory("relative/path")).toBeUndefined();
        expect(
            resolveRealDirectory(path.join(root, "missing")),
        ).toBeUndefined();
        const filePath = path.join(root, "note.md");
        fs.writeFileSync(filePath, "hello");
        expect(resolveRealDirectory(filePath)).toBeUndefined();
    });

    test("detects when a canonical root path is replaced by a junction", () => {
        const originalRoot = path.join(temporaryDirectory, "Original");
        fs.renameSync(root, originalRoot);
        fs.symlinkSync(sibling, root, "junction");
        try {
            expect(isCanonicalDirectory(root)).toBe(false);
        } finally {
            fs.unlinkSync(root);
        }
    });
});
