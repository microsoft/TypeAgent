// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import { expandHome } from "../src/installSources/addSource.js";

describe("paths.expandHome", () => {
    it("expands a bare '~' to the home directory", () => {
        expect(expandHome("~")).toBe(os.homedir());
    });
    it("expands '~/foo' joined to the home directory", () => {
        expect(expandHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
    });
    it("expands a backslash '~\\\\foo' too", () => {
        expect(expandHome("~\\foo")).toBe(path.join(os.homedir(), "foo"));
    });
    it("leaves a non-tilde path unchanged", () => {
        expect(expandHome("/abs/path")).toBe("/abs/path");
        expect(expandHome("relative/path")).toBe("relative/path");
    });
    it("does not expand a tilde that is not a path prefix", () => {
        expect(expandHome("~user/foo")).toBe("~user/foo");
    });
});
