// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Node-only helpers, re-exported (via the "@typeagent/agent-sdk/node" subpath)
// from the single shared implementation in @typeagent/common-utils so the
// `node:child_process` dependency stays isolated from this package's main
// entry, which is also consumed by browser/renderer bundles.

export {
    resolveCliOnPath,
    claudeExecutableOption,
} from "@typeagent/common-utils";
