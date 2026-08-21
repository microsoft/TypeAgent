// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import { fileLinkToPath, isFileLink } from "../src/fileLink.js";

describe("fileLinkToPath", () => {
    it("recovers a Windows path", () => {
        expect(
            fileLinkToPath("typeagent-file:///D:/Git/TypeAgent/ts/config.yaml"),
        ).toBe("D:\\Git\\TypeAgent\\ts\\config.yaml");
    });

    it("decodes escaped characters", () => {
        expect(
            fileLinkToPath("typeagent-file:///D:/My%20Docs/config.local.yaml"),
        ).toBe("D:\\My Docs\\config.local.yaml");
    });

    it("recovers a POSIX path", () => {
        expect(fileLinkToPath("typeagent-file:///home/me/ts/config.yaml")).toBe(
            "/home/me/ts/config.yaml",
        );
    });

    it("rejects UNC paths", () => {
        expect(
            fileLinkToPath("typeagent-file://server/share/config.yaml"),
        ).toBeUndefined();
    });

    it("rejects encoded traversal and malformed escapes", () => {
        expect(
            fileLinkToPath(
                "typeagent-file:///D:/repo/ts/%2e%2e/other/config.local.yaml",
            ),
        ).toBeUndefined();
        expect(
            fileLinkToPath("typeagent-file:///D:/repo/%E0%A4%A"),
        ).toBeUndefined();
    });

    it("ignores other schemes", () => {
        expect(fileLinkToPath("https://example.org/file.yaml")).toBeUndefined();
        expect(isFileLink("https://example.org")).toBe(false);
    });
});
