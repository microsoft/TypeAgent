#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseArgs } from "node:util";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { collectCatalog } from "./collect.js";
import { renderHtml } from "./render.js";

const HELP = `action-browser — generate the self-contained TypeAgent Action Browser.

Usage:
    action-browser [--out <file.html>] [--json] [--check] [--allow-missing] [--help]

Options:
  --out <file>   Output HTML path. Defaults to
                 ts/docs/overview/action-browser.html.
  --json         Also write the raw catalog JSON next to the HTML output.
    --check        Require valid links and action coverage for every endpoint.
    --allow-missing
                                 Report the migration baseline without failing on missing links.
  --help         Show this message.

The generator reads bundled agent manifests, action schemas, and grammar
files from the workspace, and boots a headless read-only dispatcher to
enumerate each host's @-commands (no network, no LLM, no API keys). Dynamic
runtime capabilities (MCP tools, recorded web flows) are out of scope.
`;

function defaultOutPath(): string {
    // dist/cli.js -> ts/tools/actionBrowser/dist -> up 3 to ts.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const tsDir = path.resolve(here, "..", "..", "..");
    return path.join(tsDir, "docs", "overview", "action-browser.html");
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            out: { type: "string" },
            json: { type: "boolean", default: false },
            check: { type: "boolean", default: false },
            "allow-missing": { type: "boolean", default: false },
            help: { type: "boolean", default: false },
        },
        allowPositionals: false,
        strict: true,
    });

    if (values.help) {
        process.stdout.write(HELP);
        return;
    }

    const outPath =
        typeof values.out === "string" && values.out.length > 0
            ? path.resolve(values.out)
            : defaultOutPath();

    const catalog = await collectCatalog({ strict: values.check });

    if (values.check) {
        const issues = catalog.commandActionLinkIssues;
        const missing = catalog.missingCommandActions;
        process.stdout.write(
            `Command action coverage: ${catalog.counts.linkedCommandEndpoints} / ` +
                `${catalog.counts.commandEndpoints} endpoints ` +
                `(${missing.length} missing, ${issues.length} invalid)\n`,
        );
        if (issues.length > 0) {
            for (const issue of issues) {
                const command =
                    issue.host === "system"
                        ? `@${issue.path}`
                        : issue.path.length > 0
                          ? `@${issue.host} ${issue.path}`
                          : `@${issue.host}`;
                const action = issue.schema
                    ? `${issue.schema}.${issue.actionName}`
                    : issue.actionName;
                process.stderr.write(
                    `${command} -> ${action}: ${issue.message}\n`,
                );
            }
        }
        if (!values["allow-missing"]) {
            for (const gap of missing) {
                const command =
                    gap.host === "system"
                        ? `@${gap.path}`
                        : gap.path.length > 0
                          ? `@${gap.host} ${gap.path}`
                          : `@${gap.host}`;
                process.stderr.write(`${command}: no equivalent action\n`);
            }
        }
        if (catalog.runtimeOnlySchemas.length > 0) {
            process.stdout.write(
                `Runtime-only schemas omitted: ${catalog.runtimeOnlySchemas.join(", ")}\n`,
            );
        }
        if (
            issues.length > 0 ||
            (missing.length > 0 && !values["allow-missing"])
        ) {
            process.exitCode = 1;
        }
        return;
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });

    if (values.json) {
        const jsonPath = outPath.replace(/\.html?$/i, "") + ".json";
        await fs.writeFile(
            jsonPath,
            JSON.stringify(catalog, undefined, 2),
            "utf8",
        );
        process.stdout.write(`wrote ${jsonPath}\n`);
    }

    const html = renderHtml(catalog);
    await fs.writeFile(outPath, html, "utf8");

    process.stdout.write(
        `Action browser: ${catalog.counts.agents} agents, ` +
            `${catalog.counts.actions} actions, ` +
            `${catalog.counts.commandEndpoints} command endpoints\n`,
    );
    process.stdout.write(`wrote ${outPath}\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
