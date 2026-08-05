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

    it("recovers a UNC path", () => {
        expect(
            fileLinkToPath("typeagent-file://server/share/config.yaml"),
        ).toBe("\\\\server\\share\\config.yaml");
    });

    it("ignores other schemes", () => {
        expect(fileLinkToPath("https://example.org/file.yaml")).toBeUndefined();
        expect(isFileLink("https://example.org")).toBe(false);
    });
});
