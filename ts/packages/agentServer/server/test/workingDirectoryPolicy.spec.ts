// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    loadWorkingDirectoryPolicy,
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
});
