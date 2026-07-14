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
  action-browser [--out <file.html>] [--json] [--help]

Options:
  --out <file>   Output HTML path. Defaults to
                 ts/docs/overview/action-browser.html.
  --json         Also write the raw catalog JSON next to the HTML output.
  --help         Show this message.

The generator is fully static: it reads bundled agent manifests, action
schemas, and grammar files from the workspace (no running dispatcher, no
network, no LLM). Dynamic runtime capabilities (MCP tools, recorded web
flows) are out of scope.
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

    const catalog = await collectCatalog();

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
            `${catalog.counts.commands} system commands\n`,
    );
    process.stdout.write(`wrote ${outPath}\n`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
