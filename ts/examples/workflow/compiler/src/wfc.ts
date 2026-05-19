#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * wfc: workflow DSL compiler.
 *
 * Compiles `.wf` source files into workflow IR JSON suitable for the
 * `workflow run` runtime. Reports lex / parse / typecheck / emit / validate
 * errors in a `file:line:col phase message` format.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename, extname, join } from "node:path";
import { createRequire } from "node:module";
import { compile, CompileError, TaskSchemaInfo } from "workflow-dsl";
import { allBuiltinTasks } from "workflow-engine";

const require = createRequire(import.meta.url);
const pkgVersion: string = require("../package.json").version;

const usage = `Usage:
  wfc <file.wf> [options]    Compile a .wf source file to workflow IR JSON

Options:
  -o, --out <file>     Write IR to <file>. Defaults to <input>.json next to
                       the input. Use "-" for stdout.
  --no-validate        Skip IR validation after emit (validation is on by
                       default).
  --pretty             Pretty-print the JSON output with 2-space indent
                       (default).
  --compact            Emit minified JSON (no whitespace).
  -h, --help           Show this help.
  -V, --version        Show version and exit.`;

function fail(msg: string): never {
    console.error(msg);
    process.exit(1);
}

function readSource(file: string): { abs: string; source: string } {
    const abs = resolve(file);
    try {
        return { abs, source: readFileSync(abs, "utf8") };
    } catch (e) {
        fail(`Cannot read file: ${abs}: ${(e as Error).message}`);
    }
}

function defaultOutPath(inputAbs: string): string {
    const dir = dirname(inputAbs);
    const base = basename(inputAbs, extname(inputAbs));
    return join(dir, `${base}.json`);
}

function builtinTaskSchemas(): TaskSchemaInfo[] {
    return allBuiltinTasks.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
    }));
}

function formatError(inputDisplay: string, e: CompileError): string {
    const loc = e.line > 0 || e.col > 0 ? `${e.line}:${e.col}` : "-";
    return `${inputDisplay}:${loc} [${e.phase}] ${e.message}`;
}

interface ParsedArgs {
    input: string;
    out?: string;
    validate: boolean;
    pretty: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    let input: string | undefined;
    let out: string | undefined;
    let validate = true;
    let pretty = true;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "-h":
            case "--help":
                console.log(usage);
                process.exit(0);
                break;
            case "-V":
            case "--version":
                console.log(`wfc ${pkgVersion}`);
                process.exit(0);
                break;
            case "-o":
            case "--out": {
                const v = argv[++i];
                if (!v) fail("--out requires a path");
                out = v;
                break;
            }
            case "--no-validate":
                validate = false;
                break;
            case "--pretty":
                pretty = true;
                break;
            case "--compact":
                pretty = false;
                break;
            default:
                if (a.startsWith("-")) fail(`Unknown option: ${a}\n\n${usage}`);
                if (input !== undefined) {
                    fail(
                        `Unexpected extra argument: ${a}. Only one input file is supported.`,
                    );
                }
                input = a;
                break;
        }
    }

    if (!input) fail(usage);
    const parsed: ParsedArgs = { input, validate, pretty };
    if (out !== undefined) parsed.out = out;
    return parsed;
}

function writeOutput(
    target: string | undefined,
    body: string,
    inputAbs: string,
): string {
    if (target === "-") {
        process.stdout.write(body);
        if (!body.endsWith("\n")) process.stdout.write("\n");
        return "<stdout>";
    }
    const outPath = resolve(target ?? defaultOutPath(inputAbs));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body.endsWith("\n") ? body : body + "\n", "utf8");
    return outPath;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const { abs, source } = readSource(args.input);
    const inputDisplay = args.input;

    const result = compile(source, builtinTaskSchemas(), {
        validate: args.validate,
    });

    if (result.errors.length > 0) {
        for (const e of result.errors) {
            console.error(formatError(inputDisplay, e));
        }
        console.error(
            `\n${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`,
        );
        process.exit(1);
    }

    if (!result.ir) {
        fail("Internal error: compiler returned no IR and no errors.");
    }

    const body = args.pretty
        ? JSON.stringify(result.ir, null, 2)
        : JSON.stringify(result.ir);
    const where = writeOutput(args.out, body, abs);
    if (where !== "<stdout>") {
        console.error(`[wfc] wrote ${where}`);
    }
}

main();
