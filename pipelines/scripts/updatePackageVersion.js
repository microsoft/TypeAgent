// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

const prereleaseVersion = process.argv[2];
const packageJsonContent = fs.readFileSync("./package.json", "utf-8");
const packageJson = JSON.parse(packageJsonContent);
const currentVersion = packageJson.version;

if (currentVersion === undefined) {
    console.error(`${packageJson.name}: Current version is undefined in package.json`);
    process.exit(1);
}

if (prereleaseVersion === undefined) {
    console.error(
        `${packageJson.name}: Prerelease version argument is missing. Usage: node updatePackageVersion.js <prerelease-version>`,
    );
    process.exit(1);
}

const newVersion = `${currentVersion}-${prereleaseVersion}`;
packageJson.version = newVersion;

fs.writeFileSync(
    "./package.json",
    JSON.stringify(packageJson, null, 2) + "\n",
);

console.log(`${packageJson.name}: Package version updated to '${newVersion}'`);