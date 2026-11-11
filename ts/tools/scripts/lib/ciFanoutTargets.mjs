// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export function fullMacosQualification(
    value = process.env.TYPEAGENT_FULL_MACOS_QUALIFICATION ?? "false",
) {
    assert.ok(
        ["true", "false"].includes(value),
        `Invalid full macOS qualification selection: ${value}`,
    );
    return value === "true";
}

export function fanoutNodes() {
    return ["v24.22.1", "v26.12.1"];
}
