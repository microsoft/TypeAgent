// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { isAllowedConfigFilePath } from "../src/fileLink.js";

describe("isAllowedConfigFilePath", () => {
    const allowed = path.resolve("test-config", "config.local.yaml");

    test("allows only the normalized config target", () => {
        expect(isAllowedConfigFilePath(allowed, allowed)).toBe(true);
        expect(
            isAllowedConfigFilePath(
                path.join(path.dirname(allowed), ".", "config.local.yaml"),
                allowed,
            ),
        ).toBe(true);
    });

    test("rejects executable and unrelated local paths", () => {
        expect(
            isAllowedConfigFilePath(
                path.join(path.dirname(allowed), "payload.exe"),
                allowed,
            ),
        ).toBe(false);
        expect(
            isAllowedConfigFilePath(
                path.join(path.dirname(allowed), "other.yaml"),
                allowed,
            ),
        ).toBe(false);
    });

    test("rejects traversal to a same-named file and UNC paths", () => {
        const traversal =
            path.join(path.dirname(allowed), "child") +
            `${path.sep}..${path.sep}config.local.yaml`;
        expect(isAllowedConfigFilePath(traversal, allowed)).toBe(false);
        expect(
            isAllowedConfigFilePath(
                path.join(path.dirname(allowed), "..", "config.local.yaml"),
                allowed,
            ),
        ).toBe(false);
        expect(
            isAllowedConfigFilePath(
                "\\\\server\\share\\config.local.yaml",
                allowed,
            ),
        ).toBe(false);
    });
});
