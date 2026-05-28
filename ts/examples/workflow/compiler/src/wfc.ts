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

import { readFileSync, writeFileSync, mkdirSync, globSync } from "node:fs";
import {
    resolve,
    dirname,
    basename,
    extname,
    join,
    isAbsolute,
} from "node:path";
import { createRequire } from "node:module";
import { compileFile, CompileError } from "workflow-dsl";
import { getBuiltinTaskSchemas } from "workflow-engine";

const require = createRequire(import.meta.url);
const pkgVersion: string = require("../package.json").version;

const usage = `Usage:
  wfc <file.wf|glob> [<file.wf|glob>...] [options]
                       Compile one or more .wf source files to workflow IR
                       JSON. Glob patterns (e.g. dsl/*.wf) are expanded.

Options:
  -o, --out <path>     With a single input, write IR to <path> (or "-" for
                       stdout). With multiple inputs, <path> is treated as
                       a directory; each input is written to
                       <path>/<basename>.json.
  --entry <name>       Name of the workflow to use as the IR entry. Defaults
                       to the unique exported workflow, or the only workflow
                       if just one is defined.
  --workspace-root <dir>
                       If set, imports must resolve to files under <dir>.
                       Off by default (matches tsc, esbuild, etc.).
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

function formatError(inputDisplay: string, e: CompileError): string {
    const loc = e.line > 0 || e.col > 0 ? `${e.line}:${e.col}` : "-";
    return `${inputDisplay}:${loc} [${e.phase}] ${e.message}`;
}

interface ParsedArgs {
    inputs: string[];
    out?: string;
    entry?: string;
    workspaceRoot?: string;
    validate: boolean;
    pretty: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const inputs: string[] = [];
    let out: string | undefined;
    let entry: string | undefined;
    let workspaceRoot: string | undefined;
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
            case "--entry": {
                const v = argv[++i];
                if (!v || v.startsWith("-"))
                    fail("--entry requires a workflow name");
                entry = v;
                break;
            }
            case "--workspace-root": {
                const v = argv[++i];
                if (!v || v.startsWith("-"))
                    fail("--workspace-root requires a directory path");
                workspaceRoot = v;
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
                inputs.push(a);
                break;
        }
    }

    if (inputs.length === 0) fail(usage);
    const parsed: ParsedArgs = { inputs, validate, pretty };
    if (out !== undefined) parsed.out = out;
    if (entry !== undefined) parsed.entry = entry;
    if (workspaceRoot !== undefined) parsed.workspaceRoot = workspaceRoot;
    return parsed;
}

function expandInputs(patterns: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of patterns) {
        const hasGlob = /[*?[]/.test(p);
        const matches = hasGlob ? globSync(p) : [p];
        if (matches.length === 0) {
            fail(`No files matched: ${p}`);
        }
        for (const m of matches) {
            const abs = isAbsolute(m) ? m : resolve(m);
            if (!seen.has(abs)) {
                seen.add(abs);
                out.push(m);
            }
        }
    }
    return out;
}

function writeOutput(
    target: string | undefined,
    body: string,
    inputAbs: string,
    pretty: boolean,
    outIsDir: boolean,
): string {
    if (target === "-") {
        process.stdout.write(body);
        // Only force a trailing newline in pretty mode; --compact promises
        // "no whitespace" so we leave the stream as-is.
        if (pretty && !body.endsWith("\n")) process.stdout.write("\n");
        return "<stdout>";
    }
    let outPath: string;
    if (target === undefined) {
        outPath = resolve(defaultOutPath(inputAbs));
    } else if (outIsDir) {
        const base = basename(inputAbs, extname(inputAbs));
        outPath = resolve(join(target, `${base}.json`));
    } else {
        outPath = resolve(target);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    const payload = pretty && !body.endsWith("\n") ? body + "\n" : body;
    writeFileSync(outPath, payload, "utf8");
    return outPath;
}

function compileOne(
    inputDisplay: string,
    args: ParsedArgs,
    outIsDir: boolean,
): boolean {
    const { abs } = readSource(inputDisplay);
    const result = compileFile(abs, getBuiltinTaskSchemas(), {
        validate: args.validate,
        ...(args.entry !== undefined ? { entry: args.entry } : {}),
        ...(args.workspaceRoot !== undefined
            ? { workspaceRoot: args.workspaceRoot }
            : {}),
    });
    if (result.errors.length > 0) {
        for (const e of result.errors) {
            console.error(formatError(inputDisplay, e));
        }
        console.error(
            `\n${result.errors.length} error${result.errors.length === 1 ? "" : "s"} in ${inputDisplay}.`,
        );
        return false;
    }
    if (!result.ir) {
        console.error(
            `Internal error: compiler returned no IR and no errors for ${inputDisplay}.`,
        );
        return false;
    }
    const body = args.pretty
        ? JSON.stringify(result.ir, null, 2)
        : JSON.stringify(result.ir);
    const where = writeOutput(args.out, body, abs, args.pretty, outIsDir);
    if (where !== "<stdout>") {
        console.error(`[wfc] wrote ${where}`);
    }
    return true;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const inputs = expandInputs(args.inputs);
    const multi = inputs.length > 1;
    if (multi && args.out === "-") {
        fail("--out - (stdout) is not supported with multiple inputs.");
    }
    const outIsDir = multi && args.out !== undefined;

    let failed = 0;
    for (const inputDisplay of inputs) {
        if (!compileOne(inputDisplay, args, outIsDir)) failed++;
    }
    if (failed > 0) {
        process.exit(1);
    }
}

main();
