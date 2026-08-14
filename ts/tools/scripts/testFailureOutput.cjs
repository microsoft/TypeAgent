// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function writeTestFailures(failures) {
    const outputDirectory = process.env.TYPEAGENT_TEST_FAILURES_DIR;
    if (outputDirectory === undefined || failures.length === 0) {
        return;
    }

    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(
        outputDirectory,
        `${process.pid}-${randomUUID()}.json`,
    );
    fs.writeFileSync(outputPath, JSON.stringify(failures), "utf8");
}

module.exports = { writeTestFailures };
