// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCodingAttachmentPaths } from "../src/reasoning/codingContext.js";

describe("coding context attachments", () => {
    let root: string;
    let activeFile: string;
    let outside: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "coding-context-"));
        activeFile = path.join(root, "active.ts");
        fs.writeFileSync(activeFile, "export const value = 1;\n");
        outside = path.join(os.tmpdir(), `outside-${Date.now()}.ts`);
        fs.writeFileSync(outside, "outside\n");
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { force: true });
    });

    test("adds a workspace-relative active file and preserves attachments", () => {
        expect(
            getCodingAttachmentPaths(root, ["provided.md"], {
                activeApp: "code",
                editor: { activeFilePath: "active.ts" },
            }),
        ).toEqual(["provided.md", fs.realpathSync(activeFile)]);
    });

    test("does not attach an active file outside the coding root", () => {
        expect(
            getCodingAttachmentPaths(root, undefined, {
                activeApp: "code",
                editor: { activeFilePath: outside },
            }),
        ).toBeUndefined();
    });
});
