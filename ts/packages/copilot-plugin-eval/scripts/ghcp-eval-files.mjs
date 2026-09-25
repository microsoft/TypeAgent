// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import {
    fileFixture,
    expectedFiles,
    logicalFileContent,
    writableFiles,
} from "./ghcp-eval-corpus.mjs";

export function snapshotFiles(root) {
    const files = {};
    const invalidEntries = [];
    for (const name of fs.readdirSync(root).sort()) {
        const file = path.join(root, name);
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size > 1024 * 1024
        ) {
            invalidEntries.push(name);
        } else {
            files[name] = fs.readFileSync(file, "utf8");
        }
    }
    return { files, invalidEntries };
}

export function fileStateMatches(snapshot, expected, mutable = []) {
    if (!expected || snapshot.invalidEntries.length) return false;
    if (
        JSON.stringify(Object.keys(snapshot.files).sort()) !==
        JSON.stringify(Object.keys(expected).sort())
    )
        return false;
    return Object.entries(expected).every(([name, content]) =>
        mutable.includes(name)
            ? logicalFileContent(snapshot.files[name]) ===
              logicalFileContent(content)
            : snapshot.files[name] === content,
    );
}

export function gradeFileState(id, snapshot, issueNumber, issueTitle) {
    return fileStateMatches(
        snapshot,
        expectedFiles(id, issueNumber, issueTitle),
        writableFiles(id).filter((name) => name !== "grocery-backup.txt"),
    );
}

export function restoreFiles(root) {
    for (const name of fs.readdirSync(root)) {
        if (![...Object.keys(fileFixture), "grocery-backup.txt"].includes(name))
            throw new Error(`Unexpected fixture entry before reset: ${name}`);
        const file = path.join(root, name);
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
            throw new Error(`Unsafe fixture entry before reset: ${name}`);
        fs.unlinkSync(file);
    }
    for (const [name, contents] of Object.entries(fileFixture))
        fs.writeFileSync(path.join(root, name), contents);
}
