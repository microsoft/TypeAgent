// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Node-only CLI-path helpers, re-exported from the single shared implementation
// in @typeagent/common-utils (so the logic isn't duplicated per package).

export {
    resolveCliOnPath,
    claudeExecutableOption,
} from "@typeagent/common-utils";
