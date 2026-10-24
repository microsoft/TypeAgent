// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parse, unquote, type Grammar, type Node } from "./parsers.js";

// Turns code fences and inline code into simple commands, using the bash and
// PowerShell tree-sitter grammars. Conservative: commands with syntax errors
// are skipped, never guessed.
//
//   "$ rtk proxy gh pr view <n> --json comments | jq ."
//     → [{ argv: ["gh","pr","view","<n>","--json","comments"], opaque: {3} },
//        { argv: ["jq","."] }]

/** Fence languages treated as shell. `console` requires `$ ` prompts. */
const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh"]);
const PWSH_LANGS = new Set(["powershell", "pwsh", "ps1", "ps"]);
const CONSOLE_LANGS = new Set(["console", "shell-session"]);

type Dialect = "posix" | "pwsh";
/** Transcript prompts, e.g. `$ gh pr view` and `PS C:\> ./x.ps1`. */
const PROMPT: Record<Dialect, RegExp> = {
    posix: /^\s*\$ /,
    pwsh: /^\s*PS(?: [^>]*)?> /,
};
const GRAMMAR: Record<Dialect, Grammar> = { posix: "bash", pwsh: "powershell" };
/** Line-continuation character: a prompted line ending in it continues. */
const CONTINUATION: Record<Dialect, string> = { posix: "\\", pwsh: "`" };
/** PowerShell cmdlets are Verb-Noun (Get-ChildItem): not PATH tools. */
const CMDLET = /^[A-Z][a-z]+-[A-Z][A-Za-z]*$/;
/** Doc placeholders, e.g. `<pr>`, `{baseDir}`, `[flags]`, `...`. */
const PLACEHOLDER = /^<.*>$|^\{[^}]*\}$|\.\.\.|^\[.*\]$|^…$/;
/**
 * Doc placeholders that are shell syntax: `<a|b>` (redirection, pipe) and
 * `{baseDir}` (brace group). Masked innermost first before parsing.
 */
const MASKED_PLACEHOLDER = /<[^<>\s]+>|\{\w+\}/g;
/** HTTP examples (`GET /api/items`) are not shell, even in a mislabeled fence. */
const HTTP_METHODS = new Set([
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "CONNECT",
    "TRACE",
]);
/** Bash nodes whose value is only known at run time. */
const BASH_EXPANSIONS = [
    "simple_expansion",
    "expansion",
    "command_substitution",
    "process_substitution",
    "arithmetic_expansion",
];
/** PowerShell nodes whose value is only known at run time. */
const PWSH_EXPANSIONS = ["variable", "sub_expression"];
/** Interpreter options whose value is inline code, not a script path. */
const INLINE_CODE_FLAGS = new Set([
    "-m",
    "-c",
    "-e",
    "-command",
    "-encodedcommand",
]);

/** Wrapper prefixes stripped before the real command (longest match first). */
const WRAPPERS: string[][] = [
    ["rtk", "proxy"],
    ["uv", "run"],
    ["pnpm", "exec"],
    ["pnpm", "dlx"],
    ["npm", "exec"],
    ["npx"],
    ["uvx"],
    ["bunx"],
    ["sudo"],
    ["time"],
    ["exec"],
    ["command"],
    ["timeout"],
    ["nohup"],
];

/** Interpreters whose first non-flag argument is the real script. */
const INTERPRETERS = new Set([
    "python",
    "python3",
    "node",
    "bash",
    "sh",
    "zsh",
    "bun",
    "tsx",
    "ts-node",
    "deno",
    "perl",
    "ruby",
    "pwsh",
    "powershell",
]);

/** Shell builtins and keywords: never treated as tools. */
const BUILTINS = new Set([
    "cd",
    "export",
    "source",
    ".",
    "echo",
    "printf",
    "set",
    "unset",
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "do",
    "done",
    "while",
    "case",
    "esac",
    "function",
    "return",
    "local",
    "read",
    "eval",
    "trap",
    "true",
    "false",
    "test",
    "[",
    "[[",
    "alias",
    "exit",
    "shift",
    "wait",
    "pushd",
    "popd",
]);

export interface Command {
    /** Original simple command text, e.g. "python scripts/x.py --pr 1". */
    raw: string;
    /** Tool word after unwrapping, e.g. "gh" or "scripts/fetch.py". */
    tool: string;
    /** True when `tool` came from an interpreter argument or looks like a path. */
    isPath: boolean;
    /** Arguments after the tool. */
    args: string[];
    /** Indexes into `args` that are placeholders or expansions. */
    opaque: Set<number>;
    line: number;
    /** 1-based column of each arg and of the tool, for diagnostics. */
    toolCol: number;
    argCols: number[];
    argLines: number[];
}

interface Token {
    text: string;
    line: number;
    col: number;
    opaque: boolean;
}

export function isShellLang(lang: string): boolean {
    return (
        SHELL_LANGS.has(lang) || PWSH_LANGS.has(lang) || CONSOLE_LANGS.has(lang)
    );
}

/** Extract simple commands from a fence; `inline` spans need ≥2 words. */
export function commandsFromCode(
    lang: string,
    value: string,
    line: number,
    col: number,
): Command[] {
    if (lang === "inline") {
        return parseCommands(value, line, col, "posix", true).filter(
            (c) => c.args.length > 0,
        );
    }
    if (!isShellLang(lang)) return [];
    const dialect: Dialect = PWSH_LANGS.has(lang) ? "pwsh" : "posix";
    return parseCommands(
        transcriptToScript(value, dialect, CONSOLE_LANGS.has(lang)),
        line,
        col,
        dialect,
        false,
    );
}

/**
 * A fence with prompts is a transcript: keep prompted lines (and their
 * continuations), blank everything else. Same length, so positions hold.
 *   "$ gh pr list\n#1 fix" → "  gh pr list\n     "
 */
function transcriptToScript(
    text: string,
    dialect: Dialect,
    consoleMode: boolean,
): string {
    const lines = text.split("\n");
    if (!consoleMode && !lines.some((l) => PROMPT[dialect].test(l)))
        return text;
    let continues = false;
    return lines
        .map((l) => {
            const prompt = PROMPT[dialect].exec(l);
            const keep = prompt !== null || continues;
            continues = keep && l.trimEnd().endsWith(CONTINUATION[dialect]);
            if (!keep) return " ".repeat(l.length);
            return prompt
                ? " ".repeat(prompt[0].length) + l.slice(prompt[0].length)
                : l;
        })
        .join("\n");
}

/** Parse with the dialect's grammar and convert each simple command. */
function parseCommands(
    text: string,
    line: number,
    col: number,
    dialect: Dialect,
    strict: boolean,
): Command[] {
    // `tab <new|<index>>` → `tab ____________`: same length, so tokens map
    // back to the original `<…>` text.
    let masked = text;
    for (let prev = ""; prev !== masked; ) {
        prev = masked;
        masked = masked.replace(MASKED_PLACEHOLDER, (m) =>
            "_".repeat(m.length),
        );
    }
    return parse(GRAMMAR[dialect], masked, (root) => {
        // Inline prose that is not valid shell is not a command.
        if (strict && root.hasError) return [];
        const out: Command[] = [];
        for (const node of root.descendantsOfType("command")) {
            if (insideError(node)) continue; // claim nothing about broken syntax
            const tokens =
                dialect === "posix"
                    ? bashTokens(node, text)
                    : pwshTokens(node, text);
            const at = (t: Omit<Token, "line" | "col">, n: Node): Token => ({
                ...t,
                line: line + n.startPosition.row,
                col: col + n.startPosition.column,
            });
            if (!tokens.length || HTTP_METHODS.has(tokens[0].node.text))
                continue;
            const cmd = toCommand(
                tokens.map((t) => at(t, t.node)),
                dialect,
            );
            if (cmd) out.push(cmd);
        }
        return out;
    });
}

/** The command has a syntax error, or the parser recovered it from one. */
function insideError(node: Node): boolean {
    if (node.hasError) return true;
    for (let n = node.parent; n; n = n.parent) {
        if (n.type === "ERROR") return true;
    }
    return false;
}

type NodeToken = Omit<Token, "line" | "col"> & { node: Node };

/** bash `command`: name + arguments; assignments (`FOO=1 cmd`) are fields we skip. */
function bashTokens(cmd: Node, original: string): NodeToken[] {
    const name = cmd.childForFieldName("name");
    if (!name) return [];
    return [name, ...cmd.childrenForFieldName("argument")].map((n) =>
        token(n, original, bashValue(n), BASH_EXPANSIONS),
    );
}

/** PowerShell `command`: name (or `& path`) + elements, minus separators. */
function pwshTokens(cmd: Node, original: string): NodeToken[] {
    const name = cmd.childForFieldName("command_name");
    if (!name) return [];
    const elements =
        cmd
            .childForFieldName("command_elements")
            ?.namedChildren.filter((n) => n.type !== "command_argument_sep") ??
        [];
    return [name, ...elements].map((n) => {
        const str = n.descendantsOfType("string_literal")[0];
        const value = str && str.text === n.text ? unquote(n) : n.text;
        return token(n, original, value, PWSH_EXPANSIONS);
    });
}

/** Word value with quotes removed: `--since="$D"` → `--since=$D`. */
function bashValue(n: Node): string {
    if (
        n.type === "string" ||
        n.type === "raw_string" ||
        n.type === "ansi_c_string"
    )
        return unquote(n).replace(/^\$?['"]|['"]$/g, "");
    if (n.type === "concatenation")
        return n.namedChildren.map(bashValue).join("");
    return n.text;
}

function token(
    n: Node,
    original: string,
    value: string,
    expansions: string[],
): NodeToken {
    // Unmasked source text for placeholders like `<n>`.
    const raw = original.slice(n.startIndex, n.endIndex);
    const text = raw !== n.text ? raw : value;
    const opaque =
        PLACEHOLDER.test(text) || n.descendantsOfType(expansions).length > 0;
    return { node: n, text, opaque };
}

function toCommand(tokens: Token[], dialect: Dialect): Command | undefined {
    const raw = tokens.map((x) => x.text).join(" ");
    let t = [...tokens];
    if (t[0]?.text === "env") {
        t.shift();
        while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=|^-/.test(t[0].text)) {
            t.shift();
        }
    }
    let changed = true;
    while (changed && t.length) {
        changed = false;
        for (const w of WRAPPERS) {
            if (w.every((word, i) => t[i]?.text === word)) {
                // `command -v x` is a lookup, not an invocation.
                if (w[0] === "command" && /^-[vV]$/.test(t[1]?.text ?? ""))
                    return undefined;
                t = t.slice(w.length);
                if (w[0] === "timeout" && /^\d/.test(t[0]?.text ?? ""))
                    t = t.slice(1);
                // `uv run --with x` style options belong to the wrapper.
                while (t.length && t[0].text.startsWith("-")) t.shift();
                changed = true;
                break;
            }
        }
    }
    if (!t.length || t[0].opaque) return undefined;
    let head = t[0];
    let rest = t.slice(1);
    let isPath =
        /[/\\]/.test(head.text) ||
        /\.(py|js|mjs|cjs|ts|sh|ps1)$/.test(head.text);
    if (INTERPRETERS.has(head.text)) {
        if (head.text === "deno" && rest[0]?.text === "run")
            rest = rest.slice(1);
        // `pwsh -ExecutionPolicy Bypass -File x.ps1`: the path follows -File.
        const pwsh = head.text === "pwsh" || head.text === "powershell";
        const file = pwsh
            ? rest.findIndex((x) => /^-f(?:ile)?$/i.test(x.text))
            : -1;
        const idx =
            file >= 0
                ? file + 1
                : rest.findIndex((x) => !x.text.startsWith("-"));
        if (idx < 0 || idx >= rest.length) return undefined;
        // `python -m pkg`, `bash -c "..."`, `perl -e '...'` are not script invocations.
        if (
            rest
                .slice(0, idx)
                .some((x) => INLINE_CODE_FLAGS.has(x.text.toLowerCase()))
        ) {
            return undefined;
        }
        if (!/[/\\]/.test(rest[idx].text) && !/\.\w+$/.test(rest[idx].text)) {
            return undefined;
        }
        head = rest[idx];
        rest = rest.slice(idx + 1);
        isPath = true;
    }
    if (head.opaque && !isPath) return undefined;
    if (BUILTINS.has(head.text)) return undefined;
    if (dialect === "pwsh" && CMDLET.test(head.text)) return undefined;
    if (!isPath && !/^[A-Za-z0-9][\w.+-]*$/.test(head.text)) return undefined;
    const opaque = new Set<number>();
    rest.forEach((x, i) => x.opaque && opaque.add(i));
    return {
        raw,
        // `.\\scripts\\x.ps1` → `./scripts/x.ps1` so paths resolve on any OS.
        tool: isPath ? head.text.replace(/\\/g, "/") : head.text,
        isPath,
        args: rest.map((x) => x.text),
        opaque,
        line: head.line,
        toolCol: head.col,
        argCols: rest.map((x) => x.col),
        argLines: rest.map((x) => x.line),
    };
}
