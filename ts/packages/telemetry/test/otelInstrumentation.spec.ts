// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    INSTRUMENTATION_SCOPE,
    INSTRUMENTATION_SCOPE_NAME,
    INSTRUMENTATION_SCOPE_VERSION,
} from "../src/otel/instrumentation.js";

describe("instrumentation scope constants", () => {
    it("identifies the @typeagent/telemetry package", () => {
        expect(INSTRUMENTATION_SCOPE_NAME).toBe("@typeagent/telemetry");
        expect(INSTRUMENTATION_SCOPE_VERSION).toBe("0.0.1");
    });

    it("exposes a scope object matching the individual constants", () => {
        expect(INSTRUMENTATION_SCOPE).toEqual({
            name: INSTRUMENTATION_SCOPE_NAME,
            version: INSTRUMENTATION_SCOPE_VERSION,
        });
    });
});
