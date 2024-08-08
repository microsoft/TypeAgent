// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import sortPackageJson from "sort-package-json";
import validatePackageName from "validate-npm-package-name";

const staticExpectedValues = {
    license: "MIT",
    author: "Microsoft",
    homepage: "https://github.com/microsoft/TypeAgent#readme",
    repository: {
        type: "git",
        url: "https://github.com/microsoft/TypeAgent.git",
        // directory: "",
    },
};

const trademark = `## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.`;

function getExpectedValues(file) {
    const values = structuredClone(staticExpectedValues);
    values.repository.directory = path.dirname(file.name);
    return values;
}

function ensureValue(file, key, value, fix, result) {
    const originalValue =
        typeof file.json[key] === "object"
            ? JSON.stringify(file.json[key])
            : file.json[key];
    const expectedValue =
        typeof value === "object" ? JSON.stringify(value) : value;

    if (
        typeof file.json[key] === typeof value &&
        originalValue === expectedValue
    ) {
        return true;
    }
    if (fix) {
        file.json[key] = value;
    } else {
        result.push(
            `package.json ${key} should be '${expectedValue}'.  Found '${originalValue}' instead.`,
        );
    }
    return false;
}

export const rules = [
    {
        name: "npm-package-metadata",
        match: /package\.json$/i,
        check: (file, fix) => {
            const result = [];

            let failed = 0;
            const expectedValue = getExpectedValues(file);
            for (const [key, value] of Object.entries(expectedValue)) {
                if (!ensureValue(file, key, value, fix, result)) {
                    failed++;
                }
            }
            if (failed === 0) {
                return true;
            }
            return result.length === 0 ? false : result;
        },
    },
    {
        name: "package-name",
        match: /package\.json$/i,
        check: (file, fix) => {
            const result = validatePackageName(file.json.name);
            return result.validForNewPackages
                ? true
                : result.errors ?? result.warnings;
        },
    },
    {
        name: "npm-package-sort-metadata",
        match: /package\.json$/i,
        check: (file, fix) => {
            const original = file.json;
            const sorted = sortPackageJson(original);
            if (JSON.stringify(sorted) === JSON.stringify(original)) {
                return true;
            }
            if (fix) {
                file.json = sorted;
                return false;
            }
            return "package.json is not sorted";
        },
    },
    {
        name: "npm-package-readme-file",
        match: /package\.json$/i,
        check: (file, fix) => {
            if (file.json.private) {
                return true;
            }
            const dir = path.dirname(file.fullpath);
            const readme = path.join(dir, "README.md");
            if (fs.existsSync(readme)) {
                return true;
            }
            if (fix) {
                fs.writeFileSync(
                    readme,
                    `# ${file.json.name}\n\n${file.json.description}\n\n${trademark}\n`,
                );
                return false;
            }
            return `${readme} file not found`;
        },
    },
    {
        name: "npm-package-license-file",
        match: /package\.json$/i,
        check: (file, fix) => {
            if (file.json.private) {
                return true;
            }
            const dir = path.dirname(file.fullpath);
            const license = path.join(dir, "LICENSE");
            if (fs.existsSync(license)) {
                return true;
            }

            if (fix) {
                fs.copyFileSync(path.join(file.repo, "LICENSE"), license);
                return false;
            }
            return `${license} file not found`;
        },
    },
    {
        name: "readme-trademark",
        match: /README\.md$/i,
        check: (file, fix) => {
            const dir = path.dirname(file.fullpath);
            if (!fs.existsSync(path.join(dir, "package.json"))) {
                // Unrelated README.md
                return true;
            }
            if (file.content.includes(trademark)) {
                return true;
            }
            if (fix) {
                const lf = file.content.endsWith("\n") ? "\n" : "\n\n";
                file.content = `${file.content}${lf}${trademark}\n`;
                return false;
            }
            return "Trademark section is missing";
        },
    },
    {
        name: "license-content",
        match: /LICENSE$/i,
        check: (file, fix) => {
            if (file.content === getLicense(file.repo)) {
                return true;
            }
            const dir = path.dirname(file.fullpath);
            const license = path.join(dir, "LICENSE");
            if (fs.existsSync(license)) {
                return true;
            }

            if (fix) {
                fs.copyFileSync(path.join(file.repo, "LICENSE"), license);
                return false;
            }
            return "License content is incorrect";
        },
    },
];

let license;
function getLicense(repo) {
    if (license === undefined) {
        const licensePath = path.join(repo, "LICENSE");
        license = fs.readFileSync(licensePath, "utf-8");
    }
    return license;
}
