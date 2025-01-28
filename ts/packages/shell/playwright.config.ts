// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: "./test",
    /* Run tests sequentially otherwise the client will complain about locked session file */
    fullyParallel: false,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: 1, // fails with timeouts with more than 2 workers. :(
    //process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: "html",
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        // baseURL: 'http://127.0.0.1:3000',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: "on-first-retry",
    },

    maxFailures: 0,
    timeout: 300_000, // Set global timeout to 120 seconds

    /* Configure projects for major browsers */
    projects: [
        {
            name: `global setup`,
            testMatch: /global\.setup\.ts/,
            teardown: "global teardown",
        },
        {
            name: `global teardown`,
            testMatch: /global\.teardown\.ts/,
        },
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
            fullyParallel: false,
            dependencies: ["global setup"],
            //testMatch: /simple\.spec\.ts/,
        },
    ],

    /* Run your local dev server before starting the tests */
    // webServer: {
    //   command: 'npm run start',
    //   url: 'http://127.0.0.1:3000',
    //   reuseExistingServer: !process.env.CI,
    // },
});
