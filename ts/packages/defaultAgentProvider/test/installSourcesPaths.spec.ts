// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import os from "node:os";
import path from "node:path";
import {
    expandHome,
    expandEnv,
    expandPath,
} from "../src/installSources/paths.js";

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

describe("paths.expandEnv", () => {
    it("expands a single ${VAR}", () => {
        expect(expandEnv("${FOO}", { FOO: "bar" })).toBe("bar");
    });
    it("expands multiple variables", () => {
        expect(expandEnv("${A}/${B}", { A: "x", B: "y" })).toBe("x/y");
    });
    it("expands an unknown variable to empty string", () => {
        expect(expandEnv("${UNKNOWN}", {})).toBe("");
    });
    it("leaves non-matching text untouched", () => {
        expect(expandEnv("plain/path", {})).toBe("plain/path");
    });
});

describe("paths.expandPath", () => {
    it("applies both env and home expansion", () => {
        expect(expandPath("~/${VAR}", { VAR: "agents" })).toBe(
            path.join(os.homedir(), "agents"),
        );
    });
});
