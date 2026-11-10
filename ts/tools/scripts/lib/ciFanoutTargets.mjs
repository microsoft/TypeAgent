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

export function fanoutNodes(
    selection = process.env.TYPEAGENT_FANOUT_NODE_SET ?? "all",
) {
    assert.ok(
        ["all", "24-and-26"].includes(selection),
        `Unknown fan-out Node selection: ${selection}`,
    );
    return ["v24.22.1", "v26.12.1"];
}

export function fanoutIncludesControl(
    value = process.env.TYPEAGENT_FANOUT_INCLUDE_CONTROLS ?? "true",
) {
    assert.ok(
        ["true", "false"].includes(value),
        `Invalid fan-out control selection: ${value}`,
    );
    return value === "true";
}
