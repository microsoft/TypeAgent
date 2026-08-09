// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Compatibility barrel: scoring lives in `./scoring.js`.
 * Local eval harnesses import from `runner/runner.js`; keep that path stable.
 */

export * from "./scoring.js";
