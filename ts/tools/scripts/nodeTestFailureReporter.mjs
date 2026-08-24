// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import failureOutput from "./testFailureOutput.cjs";

const { writeTestFailures } = failureOutput;

export default async function* nodeTestFailureReporter(source) {
    const failures = [];
    const stderrByTestFile = new Map();

    try {
        for await (const event of source) {
            if (event.type === "test:stderr") {
                const messages = stderrByTestFile.get(event.data.file) ?? [];
                messages.push(event.data.message);
                stderrByTestFile.set(event.data.file, messages);
                continue;
            }

            const error = event.data?.details?.error;
            if (
                event.type === "test:fail" &&
                error?.failureType !== "subtestsFailed"
            ) {
                const failure = error.cause ?? error;
                const failureMessage =
                    failure === "test failed"
                        ? (stderrByTestFile.get(event.data.file)?.join("") ??
                          failure)
                        : (failure.stack ?? failure.message ?? String(failure));
                failures.push({
                    testFilePath: event.data.file ?? event.data.name,
                    fullName: event.data.name,
                    failureMessages: [failureMessage],
                });
            }
        }
    } finally {
        writeTestFailures(failures);
    }
}
