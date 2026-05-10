// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { playwrightLauncher } from "@web/test-runner-playwright";

/** @type {import("@web/test-runner").TestRunnerConfig} */
export default {
    files: "dist/test/components/**/*.test.js",
    nodeResolve: true,
    browsers: [
        playwrightLauncher({
            product: "chromium",
            launchOptions: { headless: true },
        }),
    ],
    // Tests run against compiled output in dist/test/components/.
    // The package build step must run first (tsc -b test/components).
    rootDir: ".",
};
