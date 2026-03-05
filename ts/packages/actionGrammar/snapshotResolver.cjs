// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Redirects Jest snapshots from dist/test/__snapshots__/ to test/__snapshots__/
// so they live alongside source and can be committed.

const path = require("path");

// The regexes use [/\\] to match both POSIX and Windows path separators;
// replacements use path.sep so the output path uses the host platform's separator.
module.exports = {
    resolveSnapshotPath: (testPath, snapshotExtension) =>
        path.join(
            path
                .dirname(testPath)
                .replace(/[/\\]dist[/\\]test$/, path.sep + "test"),
            "__snapshots__",
            path.basename(testPath) + snapshotExtension,
        ),

    resolveTestPath: (snapshotPath, snapshotExtension) =>
        path.join(
            path
                .dirname(path.dirname(snapshotPath))
                .replace(/[/\\]test$/, path.sep + "dist" + path.sep + "test"),
            path.basename(snapshotPath, snapshotExtension),
        ),

    testPathForConsistencyCheck: "some/dist/test/example.spec.js",
};
