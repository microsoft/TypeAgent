// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { writeTestFailures } = require("./testFailureOutput.cjs");

class JestFailureReporter {
    onRunComplete(_testContexts, aggregatedResult) {
        const failures = [];

        for (const testFileResult of aggregatedResult.testResults) {
            const failedTests = testFileResult.testResults.filter(
                (testResult) => testResult.status === "failed",
            );

            for (const failedTest of failedTests) {
                failures.push({
                    testFilePath: testFileResult.testFilePath,
                    fullName: failedTest.fullName,
                    failureMessages: failedTest.failureMessages,
                });
            }

            if (
                failedTests.length === 0 &&
                typeof testFileResult.failureMessage === "string"
            ) {
                failures.push({
                    testFilePath: testFileResult.testFilePath,
                    fullName: "Test suite failed to run",
                    failureMessages: [testFileResult.failureMessage],
                });
            }
        }

        writeTestFailures(failures);
    }
}

module.exports = JestFailureReporter;
