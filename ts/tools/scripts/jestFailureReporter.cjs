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

            if (testFileResult.testExecError !== undefined) {
                failures.push({
                    testFilePath: testFileResult.testFilePath,
                    fullName: "Test suite failed outside an individual test",
                    failureMessages: [
                        testFileResult.testExecError.stack ??
                            testFileResult.testExecError.message,
                    ],
                });
            } else if (
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

        if (aggregatedResult.runExecError !== undefined) {
            failures.push({
                testFilePath: "<Jest run>",
                fullName: "Jest failed outside a test suite",
                failureMessages: [
                    aggregatedResult.runExecError.stack ??
                        aggregatedResult.runExecError.message,
                ],
            });
        }

        writeTestFailures(failures);
    }
}

module.exports = JestFailureReporter;
