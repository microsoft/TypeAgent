#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * wff: workflow DSL formatter.
 *
 * Pretty-prints .wf source files using the formatter from workflow-dsl.
 * Behaves like prettier / rustfmt: rewrites files in place by default,
 * supports --check for CI, --diff for review, and stdin/stdout pipelines.
 *
 * Exit codes:
 *   0   success and (in --check / --diff) all files already formatted
 *   1   in --check / --diff: at least one file would be changed; or any
 *       lex / parse error in any input file (file left untouched)
 *   2   argument / I/O / option error
 */

import {
    readFileSync,
    writeFileSync,
    renameSync,
    unlinkSync,
    mkdirSync,
    readSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
    lex,
    Parser,
    format,
    FormatOptions,
    LexError,
    ParseError,
} from "workflow-dsl";

const usage = `Usage:
  wff <files...> [options]    Format one or more .wf files in place

Modes (mutually exclusive):
  (default)              Rewrite each file in place.
  -c, --check            Exit 1 if any file would be changed; print the list.
                         Don't modify anything. (CI / pre-commit gate.)
      --stdout           Print formatted output to stdout. Requires exactly
                         one file argument, or stdin input.
      --diff             Print a unified diff per changed file; exit 1 if any.

Input:
  <files...>             One or more .wf source files. If none are given and
                         stdin is not a TTY, read source from stdin and write
                         the result to stdout.
      --stdin-filepath <p>  Display name used in diagnostics for stdin input.

Formatting options:
      --indent <N>       Spaces per indent level (default 4, non-negative int).
      --eol <lf|crlf|cr> Line ending (default lf).
      --print-width <N>  Soft column limit (default 100). Accepts a non-negative
                         integer or 'infinity'.

Misc:
  -h, --help             Show this help.`;

type Mode = "write" | "check" | "stdout" | "diff";

interface ParsedArgs {
    files: string[];
    mode: Mode;
    stdinFilepath?: string;
    format: FormatOptions;
}

function fail(msg: string, code = 2): never {
    process.stderr.write(`${msg}\n`);
    process.exit(code);
}

function parseEol(v: string): string {
    switch (v.toLowerCase()) {
        case "lf":
            return "\n";
        case "crlf":
            return "\r\n";
        case "cr":
            return "\r";
        default:
            fail(
                `--eol must be one of: lf, crlf, cr (got ${JSON.stringify(v)})`,
            );
    }
}

function parsePrintWidth(v: string): number {
    if (v.toLowerCase() === "infinity") return Infinity;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        fail(
            `--print-width must be a non-negative integer or 'infinity' (got ${JSON.stringify(v)})`,
        );
    }
    return n;
}

function parseIndent(v: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
        fail(
            `--indent must be a non-negative integer (got ${JSON.stringify(v)})`,
        );
    }
    return n;
}

function parseArgs(argv: string[]): ParsedArgs {
    const files: string[] = [];
    let mode: Mode = "write";
    let modeSet = false;
    let stdinFilepath: string | undefined;
    const fmt: FormatOptions = {};

    const setMode = (m: Mode, flag: string) => {
        if (modeSet && mode !== m) {
            fail(
                `${flag} cannot be combined with --${mode === "check" ? "check" : mode}.`,
            );
        }
        mode = m;
        modeSet = true;
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "-h":
            case "--help":
                process.stdout.write(`${usage}\n`);
                process.exit(0);
                break;
            case "-c":
            case "--check":
                setMode("check", a);
                break;
            case "--stdout":
                setMode("stdout", a);
                break;
            case "--diff":
                setMode("diff", a);
                break;
            case "--stdin-filepath": {
                const v = argv[++i];
                if (!v) fail("--stdin-filepath requires a value");
                stdinFilepath = v;
                break;
            }
            case "--indent": {
                const v = argv[++i];
                if (!v) fail("--indent requires a value");
                fmt.indent = parseIndent(v);
                break;
            }
            case "--eol": {
                const v = argv[++i];
                if (!v) fail("--eol requires a value");
                fmt.eol = parseEol(v);
                break;
            }
            case "--print-width": {
                const v = argv[++i];
                if (!v) fail("--print-width requires a value");
                fmt.printWidth = parsePrintWidth(v);
                break;
            }
            default:
                if (a.startsWith("-")) fail(`Unknown option: ${a}\n\n${usage}`);
                files.push(a);
                break;
        }
    }

    const parsed: ParsedArgs = { files, mode, format: fmt };
    if (stdinFilepath !== undefined) parsed.stdinFilepath = stdinFilepath;
    return parsed;
}

function readStdinSync(): string {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(8192);
    while (true) {
        let n: number;
        try {
            n = readSync(0, buf, 0, buf.length, null);
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code === "EAGAIN") continue;
            if (err.code === "EOF") break;
            throw e;
        }
        if (n === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks).toString("utf8");
}

interface FormatErr {
    phase: "lex" | "parse";
    message: string;
    line: number;
    col: number;
}

function formatSource(
    source: string,
    options: FormatOptions,
): { output?: string; errors: FormatErr[] } {
    const errors: FormatErr[] = [];
    const { tokens, errors: lexErrors, comments } = lex(source);
    for (const e of lexErrors) errors.push(toErr("lex", e));
    if (lexErrors.length > 0) return { errors };

    const { ast, errors: parseErrors } = new Parser(
        tokens,
        comments,
    ).parseSingle();
    for (const e of parseErrors) errors.push(toErr("parse", e));
    if (!ast || parseErrors.length > 0) return { errors };

    try {
        return { output: format(ast, options), errors };
    } catch (e) {
        errors.push({
            phase: "parse",
            message: `formatter threw: ${(e as Error).message}`,
            line: 0,
            col: 0,
        });
        return { errors };
    }
}

function toErr(phase: "lex" | "parse", e: LexError | ParseError): FormatErr {
    return { phase, message: e.message, line: e.line, col: e.col };
}

function reportErrors(display: string, errs: FormatErr[]): void {
    for (const e of errs) {
        const loc = e.line > 0 || e.col > 0 ? `${e.line}:${e.col}` : "-";
        process.stderr.write(`${display}:${loc} [${e.phase}] ${e.message}\n`);
    }
}

/** Minimal unified diff (line oriented). Good enough for human review. */
function unifiedDiff(a: string, b: string, label: string): string {
    if (a === b) return "";
    const aLines = a.split("\n");
    const bLines = b.split("\n");
    // Simple full-file diff: print all - and + lines with a single hunk header.
    // (Not LCS-optimal but avoids pulling in a diff dependency.)
    const out: string[] = [];
    out.push(`--- ${label}`);
    out.push(`+++ ${label} (formatted)`);
    out.push(`@@ -1,${aLines.length} +1,${bLines.length} @@`);
    for (const line of aLines) out.push(`-${line}`);
    for (const line of bLines) out.push(`+${line}`);
    return out.join("\n") + "\n";
}

/** Atomically write `content` to `path` via a sibling tmp file + rename. */
function atomicWrite(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.wff-${process.pid}-${Date.now()}.tmp`;
    writeFileSync(tmp, content, "utf8");
    try {
        renameSync(tmp, path);
    } catch (e) {
        try {
            unlinkSync(tmp);
        } catch {
            // ignore cleanup failure
        }
        throw e;
    }
}

function processFile(
    file: string,
    options: FormatOptions,
    mode: Mode,
    out: {
        anyChanged: boolean;
        anyError: boolean;
        changedFiles: string[];
    },
): void {
    const abs = resolve(file);
    let source: string;
    try {
        source = readFileSync(abs, "utf8");
    } catch (e) {
        process.stderr.write(
            `Cannot read file: ${abs}: ${(e as Error).message}\n`,
        );
        out.anyError = true;
        return;
    }

    const { output, errors } = formatSource(source, options);
    if (errors.length > 0 || output === undefined) {
        reportErrors(file, errors);
        out.anyError = true;
        return;
    }

    // --stdout always emits, even when input is already formatted, so users
    // can use `wff --stdout` as a normalizer in pipelines.
    if (mode === "stdout") {
        process.stdout.write(output);
        return;
    }

    if (output === source) return;

    out.anyChanged = true;
    out.changedFiles.push(file);

    switch (mode) {
        case "write":
            try {
                atomicWrite(abs, output);
                process.stderr.write(`[wff] formatted ${file}\n`);
            } catch (e) {
                process.stderr.write(
                    `Cannot write file: ${abs}: ${(e as Error).message}\n`,
                );
                out.anyError = true;
            }
            break;
        case "check":
            process.stderr.write(`${file}\n`);
            break;
        case "diff":
            process.stdout.write(unifiedDiff(source, output, file));
            break;
    }
}

function processStdin(args: ParsedArgs): number {
    const source = readStdinSync();
    const display = args.stdinFilepath ?? "<stdin>";
    const { output, errors } = formatSource(source, args.format);
    if (errors.length > 0 || output === undefined) {
        reportErrors(display, errors);
        return 1;
    }
    if (args.mode === "check") {
        return output === source ? 0 : 1;
    }
    if (args.mode === "diff") {
        if (output === source) return 0;
        process.stdout.write(unifiedDiff(source, output, display));
        return 1;
    }
    // write or stdout: both emit to stdout when reading from stdin.
    process.stdout.write(output);
    return 0;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));

    if (args.files.length === 0) {
        if (process.stdin.isTTY) fail(usage);
        const code = processStdin(args);
        process.exit(code);
    }

    if (args.mode === "stdout" && args.files.length > 1) {
        fail("--stdout requires exactly one input file (or stdin input).");
    }

    const out = {
        anyChanged: false,
        anyError: false,
        changedFiles: [] as string[],
    };
    for (const file of args.files) {
        processFile(file, args.format, args.mode, out);
    }

    if (out.anyError) process.exit(1);

    if (args.mode === "check") {
        if (out.anyChanged) {
            process.stderr.write(
                `\n${out.changedFiles.length} file${out.changedFiles.length === 1 ? "" : "s"} need formatting.\n`,
            );
            process.exit(1);
        }
        process.exit(0);
    }
    if (args.mode === "diff" && out.anyChanged) {
        process.exit(1);
    }
    process.exit(0);
}

main();
