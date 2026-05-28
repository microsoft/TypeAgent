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
import { createRequire } from "node:module";
import {
    lex,
    Parser,
    formatModule,
    FormatOptions,
    LexError,
    ParseError,
} from "workflow-dsl";

const require = createRequire(import.meta.url);
const pkgVersion: string = require("../package.json").version;

const usage = `Usage:
  wff <files...> [options]    Format one or more .wf files in place

Modes (mutually exclusive):
  (default)              Rewrite each file in place.
  -c, --check            Exit 1 if any file would be changed; print the list.
                         Don't modify anything. (CI / pre-commit gate.)
                         With stdin input the display name is <stdin> (or the
                         value of --stdin-filepath).
      --stdout           Print formatted output to stdout. Requires exactly
                         one file argument, or stdin input.
      --diff             Print a unified diff per changed file; exit 1 if any.
                         Works with stdin too.

Input:
  <files...>             One or more .wf source files. If none are given and
                         stdin is not a TTY, read source from stdin and write
                         the result to stdout. When reading stdin both the
                         default \`write\` mode and \`--stdout\` emit the
                         formatted source to stdout.
      --stdin-filepath <p>  Display name used in diagnostics for stdin input.

Formatting options:
      --indent <N>       Spaces per indent level (default 4, non-negative int).
      --eol <lf|crlf|cr> Line ending (default lf).
      --print-width <N>  Soft column limit (default 100). Accepts a non-negative
                         integer or 'infinity'.

Misc:
  -h, --help             Show this help.
  -V, --version          Show version and exit.`;

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
            case "-V":
            case "--version":
                process.stdout.write(`wff ${pkgVersion}\n`);
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

    const { module, errors: parseErrors } = new Parser(
        tokens,
        comments,
    ).parseModule();
    for (const e of parseErrors) errors.push(toErr("parse", e));
    if (parseErrors.length > 0) return { errors };

    try {
        return { output: formatModule(module, options), errors };
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

/**
 * Line-oriented unified diff with hunks and context lines, computed
 * via an LCS table. Intentionally dependency-free (no `diff` package
 * pulled in) since the formatter ships as a tiny standalone bin.
 * Output mimics `diff -U3` closely enough for human review.
 */
function unifiedDiff(a: string, b: string, label: string): string {
    if (a === b) return "";
    const aLines = a.split("\n");
    const bLines = b.split("\n");
    const ops = computeLineDiff(aLines, bLines);
    if (ops.length === 0) return "";
    const context = 3;
    // Group ops into hunks separated by runs of `=` longer than 2*context.
    interface Hunk {
        ops: { kind: "=" | "-" | "+"; line: string }[];
        aStart: number; // 1-based start in a
        bStart: number; // 1-based start in b
        aCount: number;
        bCount: number;
    }
    const hunks: Hunk[] = [];
    let aIdx = 0; // 0-based cursor into aLines
    let bIdx = 0;
    let i = 0;
    while (i < ops.length) {
        // Skip leading equal runs that are too far from any change.
        if (ops[i].kind === "=") {
            // Find next non-equal op.
            let j = i;
            while (j < ops.length && ops[j].kind === "=") j++;
            const runLen = j - i;
            if (j === ops.length) break; // trailing equals, nothing more.
            // Keep the last `context` equal lines as leading context.
            const skip = Math.max(0, runLen - context);
            aIdx += skip;
            bIdx += skip;
            i += skip;
        }
        // Start a new hunk.
        const hunkOps: Hunk["ops"] = [];
        const aStart = aIdx;
        const bStart = bIdx;
        let trailingEq = 0;
        while (i < ops.length) {
            const op = ops[i];
            hunkOps.push(op);
            if (op.kind === "=") {
                trailingEq++;
                aIdx++;
                bIdx++;
                // If we've seen 2*context equal lines and there is a
                // following change far enough away, end this hunk and
                // let the outer loop drop the gap.
                if (trailingEq > 2 * context) {
                    // Look ahead: is there any non-equal op remaining?
                    let k = i + 1;
                    let moreChanges = false;
                    while (k < ops.length) {
                        if (ops[k].kind !== "=") {
                            moreChanges = true;
                            break;
                        }
                        k++;
                    }
                    if (moreChanges) {
                        // Trim trailing equals beyond `context` from the hunk.
                        const trim = trailingEq - context;
                        hunkOps.splice(hunkOps.length - trim, trim);
                        aIdx -= trim;
                        bIdx -= trim;
                        i++; // consume the current op already pushed
                        break;
                    }
                }
                i++;
            } else {
                trailingEq = 0;
                if (op.kind === "-") aIdx++;
                else bIdx++;
                i++;
            }
        }
        // Compute counts.
        let aCount = 0;
        let bCount = 0;
        for (const op of hunkOps) {
            if (op.kind === "=") {
                aCount++;
                bCount++;
            } else if (op.kind === "-") aCount++;
            else bCount++;
        }
        hunks.push({
            ops: hunkOps,
            aStart: aStart + 1,
            bStart: bStart + 1,
            aCount,
            bCount,
        });
    }
    if (hunks.length === 0) return "";
    const out: string[] = [];
    out.push(`--- ${label}`);
    out.push(`+++ ${label} (formatted)`);
    for (const h of hunks) {
        out.push(`@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@`);
        for (const op of h.ops) {
            const prefix = op.kind === "=" ? " " : op.kind;
            out.push(`${prefix}${op.line}`);
        }
    }
    return out.join("\n") + "\n";
}

/**
 * Classic LCS-based line diff: O(n*m) time/space. Fine for the file
 * sizes the formatter handles (typically << 10k lines).
 */
function computeLineDiff(
    a: string[],
    b: string[],
): { kind: "=" | "-" | "+"; line: string }[] {
    const n = a.length;
    const m = b.length;
    // Build LCS length table.
    const lcs: number[][] = [];
    for (let i = 0; i <= n; i++) lcs.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] =
                a[i] === b[j]
                    ? lcs[i + 1][j + 1] + 1
                    : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const out: { kind: "=" | "-" | "+"; line: string }[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ kind: "=", line: a[i] });
            i++;
            j++;
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            out.push({ kind: "-", line: a[i] });
            i++;
        } else {
            out.push({ kind: "+", line: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ kind: "-", line: a[i++] });
    while (j < m) out.push({ kind: "+", line: b[j++] });
    return out;
}

/** Atomically write `content` to `path` via a sibling tmp file + rename. */
function atomicWrite(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    // Random suffix avoids same-millisecond collisions when multiple wff
    // processes (or workers within one process) target the same file.
    const rand = Math.random().toString(36).slice(2, 10);
    const tmp = `${path}.wff-${process.pid}-${Date.now()}-${rand}.tmp`;
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
        anyParseError: boolean;
        anyIoError: boolean;
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
        out.anyIoError = true;
        return;
    }

    const { output, errors } = formatSource(source, options);
    if (errors.length > 0 || output === undefined) {
        reportErrors(file, errors);
        out.anyParseError = true;
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
                out.anyIoError = true;
            }
            break;
        case "check":
            // Emit the changed file list on stdout so it can be piped
            // into other tools (xargs, fzf, etc.) without parsing
            // stderr. Final summary lines are still on stderr.
            process.stdout.write(`${file}\n`);
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
        anyParseError: false,
        anyIoError: false,
        changedFiles: [] as string[],
    };
    for (const file of args.files) {
        processFile(file, args.format, args.mode, out);
    }

    if (out.anyIoError) process.exit(2);
    if (out.anyParseError) process.exit(1);

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
