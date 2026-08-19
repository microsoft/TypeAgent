// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    loadWorkingDirectoryPolicy,
    inferWorkingDirectoryFromRequest,
    selectWorkingDirectoryProposal,
    resolveWorkingDirectory,
} from "../src/workingDirectoryPolicy.js";

describe("agent-server working-directory policy", () => {
    let root: string;
    let child: string;
    let outside: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-root-"));
        child = path.join(root, "project");
        fs.mkdirSync(child);
        outside = fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-outside-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    test("accepts a canonical directory within an allowed root", () => {
        expect(
            resolveWorkingDirectory(child, { allowedRoots: [root] }),
        ).toEqual({
            workingDirectory: fs.realpathSync(child),
            source: "requested",
        });
    });

    test("replaces a rejected client path with the server default", () => {
        expect(
            resolveWorkingDirectory(outside, {
                allowedRoots: [root],
                defaultRoot: child,
            }),
        ).toEqual({
            workingDirectory: fs.realpathSync(child),
            source: "default",
            rejectedRequested: true,
        });
    });

    test("removes an unauthorized path when no default is configured", () => {
        expect(
            resolveWorkingDirectory(outside, { allowedRoots: [root] }),
        ).toEqual({ rejectedRequested: true });
    });

    test("loads roots from agent-server environment settings", () => {
        expect(
            loadWorkingDirectoryPolicy({
                TYPEAGENT_CODE_ALLOWED_ROOTS: [root, outside].join(
                    path.delimiter,
                ),
                TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY: child,
            }),
        ).toEqual({
            allowedRoots: [fs.realpathSync(root), fs.realpathSync(outside)],
            defaultRoot: fs.realpathSync(child),
        });
    });

    test("infers the parent directory of a quoted file path", () => {
        const file = path.join(child, "releaseNotes.ts");
        fs.writeFileSync(file, "export {};\n");
        expect(
            inferWorkingDirectoryFromRequest(
                `Explain how "${file}" generates Markdown`,
            ),
        ).toBe(fs.realpathSync(child));
    });

    test("defaults to the local agent-server cwd when settings are absent", () => {
        expect(loadWorkingDirectoryPolicy({})).toEqual({
            allowedRoots: [],
            defaultRoot: fs.realpathSync(process.cwd()),
        });
    });

    test("retains the selected directory for a follow-up without a path", () => {
        const file = path.join(child, "releaseNotes.ts");
        fs.writeFileSync(file, "export {};\n");
        const selected = selectWorkingDirectoryProposal(
            undefined,
            `Explain "${file}"`,
            undefined,
        );
        expect(selected).toBe(fs.realpathSync(child));
        expect(
            selectWorkingDirectoryProposal(
                undefined,
                "Now fix the failing tests",
                selected,
            ),
        ).toBe(fs.realpathSync(child));
    });
});
