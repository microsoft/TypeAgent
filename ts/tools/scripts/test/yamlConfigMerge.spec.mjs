// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mergeYamlForPull, mergeYamlForPush } from "../lib/yamlConfigMerge.mjs";

const localOnlyPaths = [
    "spotify.clientId",
    "spotify.clientSecret",
    "spotify.port",
];

const local = {
    spotify: {
        clientId: "local-id",
        clientSecret: "local-secret",
        port: 8888,
    },
    maps: { clientId: "local-map" },
    extra: { LOCAL_ONLY_SETTING: "keep" },
    deployments: [{ name: "local" }],
};

const remote = {
    spotify: {
        clientId: "remote-id",
        clientSecret: "remote-secret",
        port: 9999,
    },
    maps: { clientId: "remote-map" },
    extra: { REMOTE_ONLY_SETTING: "keep" },
    deployments: [{ name: "remote" }],
};

test("pull preserves local-only paths and merges remote values", () => {
    const merged = mergeYamlForPull(local, remote, localOnlyPaths);

    assert.deepEqual(merged.spotify, local.spotify);
    assert.equal(merged.maps.clientId, "remote-map");
    assert.equal(merged.extra.LOCAL_ONLY_SETTING, "keep");
    assert.equal(merged.extra.REMOTE_ONLY_SETTING, "keep");
    assert.deepEqual(merged.deployments, [{ name: "remote" }]);
});

test("push excludes local-only paths and preserves remote-only values", () => {
    const merged = mergeYamlForPush(local, remote, localOnlyPaths);

    assert.equal(merged.spotify, undefined);
    assert.equal(merged.maps.clientId, "local-map");
    assert.equal(merged.extra.LOCAL_ONLY_SETTING, "keep");
    assert.equal(merged.extra.REMOTE_ONLY_SETTING, "keep");
    assert.deepEqual(merged.deployments, [{ name: "local" }]);
});
