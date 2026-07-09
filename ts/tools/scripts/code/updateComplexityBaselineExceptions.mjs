// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tsRoot = path.resolve(__dirname, "..", "..", "..");

const reportPath = path.join(
    tsRoot,
    "tools",
    "scripts",
    "code",
    "complexity-report",
    "report.json",
);
const outPath = path.join(
    tsRoot,
    "tools",
    "scripts",
    "code",
    "complexity-baseline-exception.json",
);

function runGit(args) {
    return execFileSync("git", args, {
        cwd: tsRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function main() {
    if (!fs.existsSync(reportPath)) {
        throw new Error(
            `Missing complexity report at ${reportPath}. Run code-complexity first.`,
        );
    }

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const cyclomatic = report?.thresholds?.cyclomatic ?? 25;
    const cognitive = report?.thresholds?.cognitive ?? 30;

    const exceptions = (report.functions ?? [])
        .filter(
            (f) =>
                (f?.cyclomatic ?? 0) > cyclomatic ||
                (f?.cognitive ?? 0) > cognitive,
        )
        .map((f) => ({
            file: f.file,
            line: f.line,
            name: f.name,
            cyclomatic: f.cyclomatic,
            cognitive: f.cognitive,
            overCyclomatic: (f.cyclomatic ?? 0) > cyclomatic,
            overCognitive: (f.cognitive ?? 0) > cognitive,
        }))
        .sort(
            (a, b) =>
                b.cyclomatic - a.cyclomatic ||
                b.cognitive - a.cognitive ||
                a.file.localeCompare(b.file) ||
                a.line - b.line,
        );

    const baseline = {
        generatedAt: new Date().toISOString(),
        sourceReport: path.relative(tsRoot, reportPath).replaceAll("\\", "/"),
        branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
        commit: runGit(["rev-parse", "HEAD"]),
        thresholds: {
            cyclomatic,
            cognitive,
        },
        totals: {
            functionsAnalyzed:
                report?.totals?.functions ?? report.functions?.length ?? 0,
            filesAnalyzed: report?.totals?.filesAnalyzed ?? 0,
            overCyclomatic:
                report?.totals?.overCyclomatic ??
                exceptions.filter((e) => e.overCyclomatic).length,
            overCognitive:
                report?.totals?.overCognitive ??
                exceptions.filter((e) => e.overCognitive).length,
            totalExceptions: exceptions.length,
        },
        exceptions,
    };

    fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");

    console.log(
        `Updated ${path.relative(tsRoot, outPath)} with ${exceptions.length} exceptions.`,
    );
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
}
