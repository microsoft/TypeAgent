// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Turns code fences and inline code into simple commands. Deterministic and
// conservative: anything not clearly a command is skipped, never guessed.
//
//   "$ rtk proxy gh pr view <n> --json comments | jq ."
//     → [{ argv: ["gh","pr","view","<n>","--json","comments"], opaque: {3} },
//        { argv: ["jq","."] }]

/** Fence languages treated as shell. `console` requires `$ ` prompts. */
const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh"]);
const PWSH_LANGS = new Set(["powershell", "pwsh", "ps1", "ps"]);
const CONSOLE_LANGS = new Set(["console", "shell-session"]);

/**
 * Syntax that differs between POSIX shells and PowerShell.
 *   posix: `$ cmd \`        pwsh: `PS C:\> cmd ``
 */
type Dialect = "posix" | "pwsh";
const PROMPT: Record<Dialect, RegExp> = {
    posix: /^\s*\$ /,
    pwsh: /^\s*PS(?: [^>]*)?> /,
};
/** Escape and line-continuation character. */
const ESCAPE: Record<Dialect, string> = { posix: "\\", pwsh: "`" };
/** PowerShell cmdlets are Verb-Noun (Get-ChildItem): not PATH tools. */
const CMDLET = /^[A-Z][a-z]+-[A-Z][A-Za-z]*$/;
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
        const cmds = commandsFromLine(value, line, col, "posix");
        return cmds.filter((c) => c.args.length > 0);
    }
    if (!isShellLang(lang)) return [];
    const consoleMode = CONSOLE_LANGS.has(lang);
    const dialect: Dialect = PWSH_LANGS.has(lang) ? "pwsh" : "posix";
    const esc = ESCAPE[dialect];
    const out: Command[] = [];
    const lines = value.split("\n");
    // A fence with prompts is a transcript: unprompted lines are output.
    const hasPrompts = lines.some((l) => PROMPT[dialect].test(l));
    let heredocEnd: string | undefined;
    let pending = "";
    let pendingLine = line;
    let pendingCol = col;
    for (let i = 0; i < lines.length; i++) {
        let text = lines[i];
        if (heredocEnd !== undefined) {
            if (text.trim() === heredocEnd) heredocEnd = undefined;
            continue;
        }
        // mdast strips the fence's indent (list items): add it back.
        let offset = col;
        const prompt = PROMPT[dialect].exec(text);
        if (prompt) {
            offset += prompt[0].length;
            text = text.slice(prompt[0].length);
        } else if ((consoleMode || hasPrompts) && !pending) {
            continue; // output line in a transcript
        }
        if (!pending) {
            pendingLine = line + i;
            pendingCol = offset;
        }
        if (text.endsWith(esc)) {
            pending += text + "\n";
            continue;
        }
        const full = pending + text;
        const fullOffset = pending ? pendingCol : offset;
        // A multiline quoted -c program is one argument, not shell commands.
        if (hasOpenQuote(full, esc)) {
            pending = full + "\n";
            continue;
        }
        pending = "";
        const heredoc =
            dialect === "posix" && /<<-?\s*['"]?(\w+)['"]?/.exec(full);
        if (heredoc) heredocEnd = heredoc[1];
        out.push(...commandsFromLine(full, pendingLine, fullOffset, dialect));
    }
    return out;
}

function hasOpenQuote(text: string, esc: string): boolean {
    let quote: string | undefined;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === esc && quote !== "'") {
            i++;
        } else if (quote) {
            if (c === quote) quote = undefined;
        } else if (c === "#" && (i === 0 || /[\s|;&]/.test(text[i - 1]))) {
            break;
        } else if (c === "'" || c === '"') {
            quote = c;
        }
    }
    return quote !== undefined;
}

function commandsFromLine(
    text: string,
    line: number,
    col: number,
    dialect: Dialect,
): Command[] {
    // HTTP examples are not shell invocations, even in a mislabeled fence.
    if (
        /^\s*(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)\s+(?:\/|https?:\/\/)/.test(
            text,
        )
    )
        return [];
    const tokens = tokenize(text, line, col, dialect);
    if (!tokens) return [];
    // Split on control operators into simple commands.
    const groups: Token[][] = [[]];
    for (const t of tokens) {
        if (["|", "||", "&&", ";", "&"].includes(t.text)) groups.push([]);
        else groups[groups.length - 1].push(t);
    }
    const out: Command[] = [];
    for (const g of groups) {
        const cmd = toCommand(g, dialect);
        if (cmd) out.push(cmd);
    }
    return out;
}

/** Quote-aware tokenizer. Returns undefined for constructs we don't model. */
function tokenize(
    text: string,
    line: number,
    col: number,
    dialect: Dialect,
): Token[] | undefined {
    // Preserve physical locations across quoted programs and continuations.
    const location = (index: number) => {
        const before = text.slice(0, index);
        const last = before.lastIndexOf("\n");
        return {
            line: line + before.split("\n").length - 1,
            col: last < 0 ? col + index : col + index - last - 1,
        };
    };
    const out: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (c === ESCAPE[dialect] && text[i + 1] === "\n") {
            i += 2;
            continue;
        }
        // PowerShell call operator: `& ./x.ps1 -Name a` runs ./x.ps1.
        if (dialect === "pwsh" && c === "&" && text[i + 1] !== "&") {
            i++;
            continue;
        }
        if (c === "#") break; // comments only start at a token boundary
        const op = /^(\|\||&&|\||;|&)/.exec(text.slice(i));
        if (op) {
            out.push({ text: op[1], ...location(i), opaque: false });
            i += op[1].length;
            continue;
        }
        if (c === "(" || c === ")" || (c === "{" && text[i + 1] === " ")) {
            return undefined; // subshells / groups
        }
        const start = i;
        let value = "";
        let opaque = false;
        while (i < text.length && !" \t\n|;&".includes(text[i])) {
            const ch = text[i];
            if (ch === "'" || ch === '"') {
                const end = text.indexOf(ch, i + 1);
                if (end < 0) return undefined;
                const inner = text.slice(i + 1, end);
                if (ch === '"' && /\$/.test(inner)) opaque = true;
                value += inner;
                i = end + 1;
            } else if (ch === "$") {
                opaque = true;
                if (text[i + 1] === "(") {
                    const end = text.indexOf(")", i);
                    if (end < 0) return undefined;
                    value += text.slice(i, end + 1);
                    i = end + 1;
                } else {
                    value += ch;
                    i++;
                }
            } else if (ch === ">" || ch === "<") {
                // Redirection: drop it and its target.
                if (value === "" || /^\d$/.test(value)) {
                    const m = /^[<>]+&?\d*\s*\S*/.exec(text.slice(i));
                    i += m ? m[0].length : 1;
                    value = "";
                    opaque = false;
                    break;
                }
                value += ch;
                i++;
            } else {
                value += ch;
                i++;
            }
        }
        if (value === "") continue;
        if (/^<[^>]*>$|^\{[^}]*\}$|\.\.\.|^\[.*\]$|^…$/.test(value)) {
            opaque = true;
        }
        out.push({ text: value, ...location(start), opaque });
    }
    return out;
}

function toCommand(tokens: Token[], dialect: Dialect): Command | undefined {
    const raw = tokens.map((x) => x.text).join(" ");
    let t = [...tokens];
    // Leading env assignments: FOO=1 BAR=x cmd
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0].text)) t.shift();
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
