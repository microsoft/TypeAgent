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
    const outputName = `${process.pid}-${randomUUID()}`;
    const temporaryPath = path.join(outputDirectory, `${outputName}.tmp`);
    const outputPath = path.join(outputDirectory, `${outputName}.json`);
    fs.writeFileSync(temporaryPath, JSON.stringify(failures), "utf8");
    fs.renameSync(temporaryPath, outputPath);
}

module.exports = { writeTestFailures };
