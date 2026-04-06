// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rules as copyrightHeadersRules } from "./policyChecks/copyrightHeaders.mjs";
import { rules as npmPackageRules } from "./policyChecks/npmPackage.mjs";
import { rules as invisibleUnicodeRules } from "./policyChecks/invisibleUnicode.mjs";
import chalk from "chalk";

/********************************************************
 * Rules
 ********************************************************/

const rules = [
    ...copyrightHeadersRules,
    ...npmPackageRules,
    ...invisibleUnicodeRules,
];

/********************************************************
 * Main
 ********************************************************/

function getCheckFiles() {
    const files = execSync("git ls-tree --full-tree -r --name-only HEAD", {
        encoding: "utf-8",
    });
    return files.trim().split("\n");
}

// Walk a directory tree without following symlinks, collecting files whose
// names match `filter`.  Errors on unreadable entries are silently skipped.
function walkDir(dir, filter, results) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isSymbolicLink()) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(full, filter, results);
        } else if (entry.isFile() && filter.test(entry.name)) {
            results.push(full);
        }
    }
}

// Return absolute paths to source files inside every node_modules/.pnpm
// directory found within the repo tree.  Scanning only .pnpm avoids reading
// the same file twice through pnpm's per-package symlinks.
function getDependencyFiles(repo, filter) {
    const pnpmDirs = [];

    // Recursively search for node_modules directories.  When found, check for
    // a .pnpm subdirectory and record it — but do not recurse further into
    // node_modules itself (avoids exploding depth through nested installs).
    function findPnpmDirs(dir, depth) {
        if (depth > 8) {
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                continue;
            }
            const full = path.join(dir, entry.name);
            if (entry.name === "node_modules") {
                const pnpmDir = path.join(full, ".pnpm");
                if (fs.existsSync(pnpmDir)) {
                    pnpmDirs.push(pnpmDir);
                }
                // Do not recurse inside node_modules
            } else {
                findPnpmDirs(full, depth + 1);
            }
        }
    }

    findPnpmDirs(repo, 0);

    const results = [];
    for (const pnpmDir of pnpmDirs) {
        walkDir(pnpmDir, filter, results);
    }
    return results;
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
    let excludedFiles = 0;
    let skippedFiles = 0;

    // Per-rule counters: { checked: number, failed: number }
    const ruleStats = new Map(
        rules.map((r) => [r.name, { checked: 0, failed: 0 }]),
    );

    const files = getCheckFiles();

    const repo = execSync("git rev-parse --show-toplevel", {
        encoding: "utf-8",
    }).trim();
    const config = loadConfig(repo);
    const fix = process.argv.includes("--fix");
    const verbose = process.argv.includes("--verbose");
    const checkDependencies = process.argv.includes("--check-dependencies");
    for (const file of files) {
        if (!checkFile(file, config)) {
            excludedFiles++;
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
            ruleStats.get(rule.name).checked++;
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
            ruleStats.get(rule.name).failed++;
        }
        if (failedFile) {
            failedFiles++;
        }
        if (rulesChecked.length === 0) {
            skippedFiles++;
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

    // Dependency scan (--check-dependencies)
    let depCheck = 0;
    let depFailed = 0;
    let depFailedFiles = 0;
    const depRules = rules.filter((r) => r.applyToDependencies);
    const depRuleStats = new Map(
        depRules.map((r) => [r.name, { checked: 0, failed: 0 }]),
    );

    if (checkDependencies && depRules.length > 0) {
        // Build a combined extension filter from all dependency rules so the
        // filesystem walk can skip non-matching files before reading them.
        const depFilter = new RegExp(
            depRules.map((r) => r.match.source).join("|"),
            "i",
        );

        console.log(chalk.bold("\nScanning dependencies..."));
        const depFiles = getDependencyFiles(repo, depFilter);
        console.log(`  Found ${depFiles.length} dependency source files.\n`);

        let ruleIndex = 0;
        for (const absPath of depFiles) {
            const relPath = path.relative(repo, absPath).replace(/\\/g, "/");
            const repoFile = new Repofile(repo, relPath);
            let failedFile = false;
            let coloredFile = chalk.red(`${relPath}:`);

            for (const rule of depRules) {
                if (!rule.match.test(relPath)) {
                    continue;
                }
                depCheck++;
                depRuleStats.get(rule.name).checked++;
                const ruleColor = colors[ruleIndex++ % colors.length];
                const coloredRule = ruleColor(`  ${rule.name}: `);
                const result = rule.check(repoFile);
                if (result === true) {
                    continue;
                }
                if (coloredFile !== undefined) {
                    console.log(coloredFile);
                    coloredFile = undefined;
                }
                if (Array.isArray(result)) {
                    for (const message of result) {
                        console.error(`${coloredRule}${message}`);
                    }
                } else {
                    console.error(`${coloredRule}${result}`);
                }
                depFailed++;
                failedFile = true;
                depRuleStats.get(rule.name).failed++;
            }
            if (failedFile) {
                depFailedFiles++;
                console.log();
            }
        }
    }

    // Rule summary
    console.log(chalk.bold("\nRule summary:"));
    for (const [name, stats] of ruleStats) {
        const failNote =
            stats.failed > 0 ? chalk.red(` (${stats.failed} failed)`) : "";
        console.log(`  ${name}: ${stats.checked} checked${failNote}`);
    }
    if (checkDependencies) {
        console.log(chalk.bold("\nDependency rule summary:"));
        for (const [name, stats] of depRuleStats) {
            const failNote =
                stats.failed > 0 ? chalk.red(` (${stats.failed} failed)`) : "";
            console.log(`  ${name}: ${stats.checked} checked${failNote}`);
        }
    }

    // File summary
    console.log(chalk.bold("\nFile summary:"));
    console.log(`  Total:    ${files.length}`);
    console.log(`  Excluded: ${excludedFiles}`);
    console.log(`  Skipped:  ${skippedFiles} (no rules matched)`);
    console.log(`  Checked:  ${files.length - excludedFiles - skippedFiles}`);

    const totalFailed = failed + depFailed;
    if (totalFailed > 0) {
        const depNote =
            depFailed > 0
                ? ` Dependency failures: ${depFailed} checks, ${depFailedFiles} files.`
                : "";
        console.error(
            chalk.red(
                `\nFailed ${failed}/${check} checks. ${failedFiles}/${files.length} files.${depNote} ${fixed !== 0 ? `Fixed ${fixed}` : ""}`,
            ),
        );
        process.exit(1);
    }

    console.log(
        chalk.green(
            `\nPassed ${check} checks. ${fixed !== 0 ? `Fixed ${fixed}` : ""}`,
        ),
    );
}

main();
