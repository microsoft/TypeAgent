// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    classifyDebugNamespace,
    debugClassAllowedByProfile,
    readDebugClass,
    DEBUG_CLASS_ATTRIBUTE,
    DEBUG_NAMESPACE_ATTRIBUTE,
    type DebugLogClass,
} from "../src/otel/debugClass.js";
import type { LocalTelemetryProfile } from "../src/otel/localTelemetryState.js";

describe("classifyDebugNamespace", () => {
    it("maps recognized trailing class suffixes to their class", () => {
        expect(classifyDebugNamespace("typeagent:foo:error")).toBe("error");
        expect(classifyDebugNamespace("typeagent:foo:warn")).toBe("warn");
        expect(classifyDebugNamespace("typeagent:foo:info")).toBe("info");
        expect(classifyDebugNamespace("typeagent:foo:verbose")).toBe("verbose");
    });

    it("uses only the final segment of a multi-segment namespace", () => {
        expect(
            classifyDebugNamespace("typeagent:translate:semantic:warn"),
        ).toBe("warn");
        expect(
            classifyDebugNamespace("typeagent:translate:semantic:info"),
        ).toBe("info");
    });

    it("defaults unclassified or unknown suffixes to verbose", () => {
        expect(classifyDebugNamespace("typeagent:translate")).toBe("verbose");
        expect(classifyDebugNamespace("plainname")).toBe("verbose");
        expect(classifyDebugNamespace("typeagent:foo:channel")).toBe("verbose");
        expect(classifyDebugNamespace("typeagent:foo:")).toBe("verbose");
        expect(classifyDebugNamespace("")).toBe("verbose");
    });

    it("is case sensitive - only lowercase suffixes are recognized", () => {
        expect(classifyDebugNamespace("typeagent:foo:ERROR")).toBe("verbose");
        expect(classifyDebugNamespace("typeagent:foo:Warn")).toBe("verbose");
    });
});

describe("readDebugClass", () => {
    it("prefers an explicit class attribute", () => {
        expect(
            readDebugClass({
                [DEBUG_CLASS_ATTRIBUTE]: "warn",
                [DEBUG_NAMESPACE_ATTRIBUTE]: "typeagent:foo:error",
            }),
        ).toBe("warn");
    });

    it("falls back to the namespace suffix when no explicit class", () => {
        expect(
            readDebugClass({
                [DEBUG_NAMESPACE_ATTRIBUTE]: "typeagent:foo:info",
            }),
        ).toBe("info");
    });

    it("ignores an invalid explicit class and uses the namespace", () => {
        expect(
            readDebugClass({
                [DEBUG_CLASS_ATTRIBUTE]: "bogus",
                [DEBUG_NAMESPACE_ATTRIBUTE]: "typeagent:foo:error",
            }),
        ).toBe("error");
    });

    it("defaults to verbose when attributes are missing", () => {
        expect(readDebugClass(undefined)).toBe("verbose");
        expect(readDebugClass({})).toBe("verbose");
        expect(readDebugClass({ [DEBUG_NAMESPACE_ATTRIBUTE]: 42 })).toBe(
            "verbose",
        );
    });
});

describe("debugClassAllowedByProfile", () => {
    const classes: readonly DebugLogClass[] = [
        "error",
        "warn",
        "info",
        "verbose",
    ];

    const expected: Record<
        LocalTelemetryProfile,
        Record<DebugLogClass, boolean>
    > = {
        off: { error: false, warn: false, info: false, verbose: false },
        focused: { error: false, warn: false, info: false, verbose: false },
        diagnostic: { error: true, warn: true, info: true, verbose: false },
        verbose: { error: true, warn: true, info: true, verbose: true },
    };

    for (const profile of Object.keys(expected) as LocalTelemetryProfile[]) {
        for (const cls of classes) {
            it(`${profile} profile ${
                expected[profile][cls] ? "surfaces" : "hides"
            } ${cls}`, () => {
                expect(debugClassAllowedByProfile(profile, cls)).toBe(
                    expected[profile][cls],
                );
            });
        }
    }
});
