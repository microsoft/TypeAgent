// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rules as copyrightHeadersRules } from "./policyChecks/copyrightHeaders.mjs";
import { rules as npmPackageRules } from "./policyChecks/npmPackage.mjs";
import chalk from "chalk";

/********************************************************
 * Rules
 ********************************************************/

const rules = [...copyrightHeadersRules, ...npmPackageRules];

/********************************************************
 * Main
 ********************************************************/

function getCheckFiles() {
    const files = execSync("git ls-tree --full-tree -r --name-only HEAD", {
        encoding: "utf-8",
    });
    return files.trim().split("\n");
}

class Repofile {
    constructor(repo, name) {
        this.name = name;
        this.repo = repo;
    }
    get fullpath() {
        return path.join(this.repo, this.name);
    }
    get content() {
        if (this._json !== undefined) {
            return `${JSON.stringify(this._json, undefined, 2)}\n`;
        }
        if (this._content === undefined) {
            this._content = fs.readFileSync(this.fullpath, "utf-8");
            this._original = this._content;
        }
        return this._content;
    }
    get json() {
        if (this._json === undefined) {
            this._json = JSON.parse(this.content);
            this._content = undefined;
        }
        return this._json;
    }
    set content(content) {
        this._content = content;
        this._json = undefined;
    }
    set json(json) {
        this._json = json;
        this._content = undefined;
    }
    save() {
        if (this._original !== undefined) {
            const content = this.content;
            if (content !== this._original) {
                fs.writeFileSync(this.fullpath, content);
                this.original = content;
                return true;
            }
        }
        return false;
    }
}

function loadConfig(repo) {
    const configPath = path.join(repo, ".repolicy.json");
    if (!fs.existsSync(configPath)) {
        return {};
    }
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

function checkFile(file, config) {
    const exclude = config.exclude;
    if (exclude === undefined) {
        return true;
    }
    return !exclude.some((prefix) => file.startsWith(prefix));
}

const colors = [
    chalk.cyanBright,
    chalk.yellowBright,
    chalk.greenBright,
    chalk.blueBright,
    chalk.magentaBright,
    chalk.redBright,
    chalk.green,
    chalk.yellow,
    chalk.blue,
    chalk.magenta,
    chalk.cyan,
];

function main() {
    let check = 0;
    let fixed = 0;
    let failed = 0;
    let failedFiles = 0;

    const files = getCheckFiles();

    const repo = execSync("git rev-parse --show-toplevel", {
        encoding: "utf-8",
    }).trim();
    const config = loadConfig(repo);
    const fix = process.argv.includes("--fix");
    const verbose = process.argv.includes("--verbose");
    for (const file of files) {
        if (!checkFile(file, config)) {
            continue;
        }
        const rulesChecked = [];
        let coloredFile = chalk.red(`${file}:`);
        const repoFile = new Repofile(repo, file);
        let failedFile = false;
        let ruleIndex = 0;
        for (const rule of rules) {
            if (!rule.match.test(file)) {
                continue;
            }
            check++;
            const ruleColor = colors[ruleIndex++ % colors.length];
            const coloredRule = ruleColor(`  ${rule.name}: `);
            rulesChecked.push(coloredRule);
            const result = rule.check(repoFile, fix);
            if (result === true) {
                continue;
            }
            if (coloredFile !== undefined) {
                console.log(coloredFile);
                coloredFile = undefined;
            }
            if (fix && result === false) {
                console.log(`${coloredRule}Fixed`);
                fixed++;
                continue;
            }
            if (Array.isArray(result)) {
                for (const message of result) {
                    console.error(`${coloredRule}${message}`);
                }
            } else {
                console.error(`${coloredRule}${result}`);
            }
            failed++;
            failedFile = true;
        }
        if (failedFile) {
            failedFiles++;
        }
        if (verbose) {
            if (rulesChecked.length === 0) {
                if (coloredFile !== undefined) {
                    console.log(coloredFile);
                    coloredFile = undefined;
                }
                console.log(`  No rules matched`);
            } else {
                if (coloredFile !== undefined) {
                    console.log(chalk.green(`${file}:`));
                    coloredFile = undefined;
                }
                console.log(
                    rulesChecked.map((name) => `${name}Passed`).join("\n"),
                );
            }
        }
        if (fix) {
            if (repoFile.save()) {
                if (coloredFile !== undefined) {
                    console.log(coloredFile);
                    coloredFile = undefined;
                }
                console.log(`  Saved changes`);
            }
        }
        if (coloredFile === undefined) {
            console.log();
        }
    }
    if (failed > 0) {
        console.error(
            chalk.red(
                `Failed ${failed}/${check} checks. ${failedFiles}/${files.length} files. ${fixed !== 0 ? `Fixed ${fixed}` : ""}`,
            ),
        );
        process.exit(1);
    }

    console.log(
        chalk.green(
            `Passed ${check} checks. ${files.length} files. ${fixed !== 0 ? `Fixed ${fixed}` : ""}`,
        ),
    );
}

main();
