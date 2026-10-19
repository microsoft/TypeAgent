// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import {
    rel,
    type BuildContext,
    type BuildResult,
    type Skill,
} from "../context.js";
import type { ParsedMarkdown } from "../markdown.js";
import { commandsFromCode, type Command } from "../shell.js";
import { sameHelp } from "../specs/help.js";
import { which } from "../specs/process.js";
import { scriptSpec } from "../specs/script.js";
import type { CliSpec, Loc, SpecRef } from "../types.js";
import { nearest } from "../util.js";

// Code spans → commands → bundled script or external tool checks.
//   `gh pr view --jsn` ──walk subcommands──▶ flag-unknown (did you mean --json?)

export const MAX_SUBCOMMAND_DEPTH = 3;
/** Skill-root placeholders used in script paths, e.g. "{baseDir}/scripts/x.py". */
const BASE_PLACEHOLDER =
    /^(?:\{baseDir\}|\$\{?CLAUDE_SKILL_DIR\}?|\$\{?SKILL_DIR\}?|<skill[-_ ]?dir>)\//;
/** Subcommand words we are willing to append to a `--help` probe. */
const SUBCOMMAND_WORD = /^[a-z][a-z0-9-]*$/;
/** Arguments after these belong to another program (open --args, ssh host cmd). */
const PASSTHROUGH = new Set(["--", "--args"]);
/** Flags nearly every CLI accepts even when help omits them. */
const UNIVERSAL_FLAGS = new Set(["--help", "--version"]);

export function commandEdges(
    ctx: BuildContext,
    skill: Skill,
    file: string,
    docId: string,
    md: ParsedMarkdown,
    res: BuildResult,
    referenced: Set<string>,
) {
    const allowed = allowedBash(md.frontmatter?.["allowed-tools"]);
    for (const code of md.code) {
        for (const cmd of commandsFromCode(
            code.lang,
            code.value,
            code.line,
            code.col,
        )) {
            // Inline prose is only a call when its executable is known.
            // Missing tools remain reportable inside explicit shell fences.
            if (
                code.lang === "inline" &&
                !cmd.isPath &&
                !ctx.store.isProbeable(cmd.tool)
            )
                continue;
            const at: Loc = {
                file,
                line: cmd.line,
                col: cmd.toolCol,
                endCol: cmd.toolCol + cmd.tool.length,
            };
            if (allowed && !allowed.some((p) => p(cmd))) {
                res.diagnostics.push({
                    rule: "tool-not-allowed",
                    severity: "info",
                    at,
                    message: `\`${cmd.raw.split(" ").slice(0, 2).join(" ")}\` not covered by allowed-tools`,
                });
            }
            if (cmd.isPath) {
                scriptCall(ctx, skill, file, docId, cmd, at, res, referenced);
            } else {
                toolCall(ctx, docId, cmd, at, res);
            }
        }
    }
}

export function scriptCall(
    ctx: BuildContext,
    skill: Skill,
    file: string,
    docId: string,
    cmd: Command,
    at: Loc,
    res: BuildResult,
    referenced: Set<string>,
) {
    const resolved = resolveScript(skill, file, cmd.tool);
    if (
        resolved &&
        file !== skill.entry &&
        path.relative(skill.dir, path.dirname(file)).split(path.sep).length > 1
    ) {
        resolved.strict = false; // deep reference trees are often vendored docs
    }
    if (!resolved) return; // absolute or repo-relative path: not ours to check
    if (TEMPLATE_PATH.test(cmd.tool)) return; // "scripts/*.py", "scripts/<name>.sh", "scripts/"
    const { target, strict } = resolved;
    if (!fs.existsSync(target)) {
        if (cmd.tool.startsWith("../") && strict) {
            // Relative command paths depend on runtime cwd, unlike Markdown hrefs.
            res.diagnostics.push({
                rule: "script-cwd-unknown",
                severity: "info",
                at,
                message: `${cmd.tool} is absent from the skill/document base; runtime working directory is not declared`,
            });
            return;
        }
        if (strict) {
            res.edges.push({
                from: docId,
                to: `script:${rel(skill, target)}`,
                kind: "invokes",
                at,
                resolved: false,
            });
            res.diagnostics.push({
                rule: "script-missing",
                severity: "error",
                at,
                message: `${cmd.tool} does not exist in skill ${skill.name}`,
            });
        }
        return;
    }
    referenced.add(target);
    const id = `script:${rel(skill, target)}`;
    const flags = cmd.args.filter(
        (a, i) => a.startsWith("-") && !cmd.opaque.has(i),
    );
    res.edges.push({
        from: docId,
        to: id,
        kind: "invokes",
        at,
        resolved: true,
        flags,
    });
    const spec = scriptSpec(target);
    if (!spec) return;
    res.specs.set(id, spec);
    const ref: SpecRef = {
        tool: rel(skill, target),
        version: spec.version,
        source: "ast",
    };
    checkFlags(ctx, cmd, 0, spec, [spec], ref, file, res);
}

export function toolCall(
    ctx: BuildContext,
    docId: string,
    cmd: Command,
    at: Loc,
    res: BuildResult,
) {
    const id = `tool:${cmd.tool}`;
    if (!ctx.store.isProbeable(cmd.tool)) {
        res.edges.push({
            from: docId,
            to: id,
            kind: "invokes",
            at,
            resolved: false,
        });
        res.diagnostics.push({
            rule: "tool-unknown",
            severity: "info",
            at,
            message: `${cmd.tool} is not on PATH; call not checked`,
        });
        return;
    }
    // Walk subcommands: gh → gh pr → gh pr view, probing each level.
    const words: string[] = [];
    const chain: CliSpec[] = [];
    let i = 0;
    for (let depth = 0; depth <= MAX_SUBCOMMAND_DEPTH; depth++) {
        const spec = ctx.store.get(cmd.tool, words);
        if (spec === undefined) {
            const key = `${cmd.tool}|${words.join(" ")}`;
            if (ctx.config.probe && !ctx.pendingKeys.has(key)) {
                ctx.pendingKeys.add(key);
                res.pending.push({ tool: cmd.tool, words: [...words] });
            }
            res.edges.push({
                from: docId,
                to: id,
                kind: "invokes",
                at,
                resolved: true,
                words: [...words],
            });
            if (ctx.config.probe) {
                res.diagnostics.push({
                    rule: "spec-pending",
                    severity: "info",
                    at,
                    message: `probing \`${[cmd.tool, ...words, "--help"].join(" ")}\``,
                });
            }
            return;
        }
        if (spec === null) break; // no usable help at this level
        // "get text --help" echoing "get --help": text is a leaf, stop walking.
        if (chain.length && sameHelp(chain[chain.length - 1], spec)) break;
        chain.push(spec);
        const next = cmd.args[i];
        if (
            next === undefined ||
            next.startsWith("-") ||
            cmd.opaque.has(i) ||
            !spec.expectsSubcommand ||
            depth === MAX_SUBCOMMAND_DEPTH
        ) {
            break;
        }
        if (!spec.subcommands.includes(next)) {
            if (!SUBCOMMAND_WORD.test(next)) break;
            // git-style external commands: `git story` runs `git-story`.
            if (!words.length && which(`${cmd.tool}-${next}`)) break;
            // Help lists often show only common commands (git, agent-browser).
            // Ask the child: a real subcommand prints its own help.
            const child = ctx.store.get(cmd.tool, [...words, next]);
            if (child === undefined) {
                const key = `${cmd.tool}|${[...words, next].join(" ")}`;
                if (ctx.config.probe && !ctx.pendingKeys.has(key)) {
                    ctx.pendingKeys.add(key);
                    res.pending.push({
                        tool: cmd.tool,
                        words: [...words, next],
                    });
                }
                if (ctx.config.probe) {
                    res.diagnostics.push({
                        rule: "spec-pending",
                        severity: "info",
                        at,
                        message: `probing \`${[cmd.tool, ...words, next, "--help"].join(" ")}\``,
                    });
                }
                res.edges.push({
                    from: docId,
                    to: id,
                    kind: "invokes",
                    at,
                    resolved: true,
                    words: [...words, next],
                });
                return;
            }
            // Unknown words often fall back to the parent's or root's help.
            // null = no usable help (error exit): unknown, so claim nothing.
            if (child === null) break;
            if (!chain.some((c) => sameHelp(c, child))) {
                words.push(next);
                i++;
                continue;
            }
            const close = nearest(next, spec.subcommands);
            res.diagnostics.push({
                rule: "subcommand-unknown",
                severity: "error",
                at: {
                    file: at.file,
                    line: cmd.argLines[i],
                    col: cmd.argCols[i],
                    endCol: cmd.argCols[i] + next.length,
                },
                message: `${[cmd.tool, ...words, next].join(" ")}${close ? ` → did you mean "${close}"?` : ""}`,
                spec: specRef(spec),
            });
            res.specs.set(`${id} ${[...words, next].join(" ")}`, spec); // hover shows the parent's commands
            res.edges.push({
                from: docId,
                to: id,
                kind: "invokes",
                at,
                resolved: false,
                words: [...words, next],
            });
            return;
        }
        words.push(next);
        i++;
    }
    const leaf = chain[chain.length - 1];
    // "tool <word> --x" where help listed no subcommands: <word> may be an
    // unlisted subcommand with its own flags, so claim nothing.
    const word =
        cmd.args[i] !== undefined &&
        !cmd.opaque.has(i) &&
        /^[A-Za-z][\w-]*$/.test(cmd.args[i]);
    // Global options before a subcommand (`npm --prefix x run`): flags after
    // `run` belong to a level we did not walk.
    const later = cmd.args
        .slice(i)
        .some(
            (a, j) =>
                !cmd.opaque.has(i + j) &&
                (leaf?.subcommands.includes(a) ||
                    (leaf?.expectsSubcommand && SUBCOMMAND_WORD.test(a))),
        );
    const unwalked =
        leaf &&
        ((word && (leaf.expectsSubcommand || !leaf.subcommands.length)) ||
            later);
    const flags = cmd.args
        .slice(i)
        .filter((a, j) => a.startsWith("-") && !cmd.opaque.has(i + j));
    res.edges.push({
        from: docId,
        to: id,
        kind: "invokes",
        at,
        resolved: true,
        words,
        flags,
    });
    if (leaf && !unwalked) {
        res.specs.set(`${id} ${words.join(" ")}`.trim(), leaf);
        checkFlags(ctx, cmd, i, leaf, chain, specRef(leaf), at.file, res);
    }
}

/** Flag names in `cmd.args[from..]` must exist in the spec chain. */
export function checkFlags(
    ctx: BuildContext,
    cmd: Command,
    from: number,
    leaf: CliSpec,
    chain: CliSpec[],
    ref: SpecRef,
    file: string,
    res: BuildResult,
) {
    if (!leaf.flags.length || leaf.partial) return; // nothing (fully) known → nothing claimed
    const known = new Set(chain.flatMap((s) => s.flags.map((f) => f.name)));
    // Terse help that lists no long flags (BSD grep, npm) claims nothing about them.
    if (
        !leaf.pwsh &&
        ![...known].some((n) => n.startsWith("--") && n !== "--help")
    )
        return;
    for (let j = from; j < cmd.args.length; j++) {
        const a = cmd.args[j];
        if (PASSTHROUGH.has(a)) break;
        if (cmd.opaque.has(j) || !/^--?[A-Za-z]/.test(a)) continue;
        const name = a.split("=")[0];
        if (leaf.pwsh) {
            // `-dry` matches `-DryRun`: PowerShell binds unique prefixes, any case.
            const n = name.split(":")[0].toLowerCase();
            const hits = [...known].filter((k) =>
                k.toLowerCase().startsWith(n),
            );
            if (hits.length || UNIVERSAL_FLAGS.has(n)) continue;
            const close = nearest(name, [...known]);
            res.diagnostics.push({
                rule: "flag-unknown",
                severity: "error",
                at: {
                    file,
                    line: cmd.argLines[j],
                    col: cmd.argCols[j],
                    endCol: cmd.argCols[j] + name.length,
                },
                message: `${name} not defined by ${ref.tool}${close ? ` → did you mean ${close}?` : ""}`,
                spec: ref,
            });
            continue;
        }
        if (!name.startsWith("--") && name.length > 2) continue; // -abc bundles
        // Help text often omits short flags (git log -n); only claim long ones.
        if (leaf.source === "help" && !name.startsWith("--")) continue;
        if (known.has(name) || UNIVERSAL_FLAGS.has(name)) continue;
        if (name.startsWith("--no-") && known.has(`--${name.slice(5)}`))
            continue;
        // Help hides some flags (clap `hide = true`: `mytool check --json`).
        // Ask the binary: `tool sub --flag --help` printing the same help
        // means the parser accepted the flag.
        if (leaf.source === "help" && ctx.config.probe) {
            const words = [...(leaf.probe?.slice(0, -1) ?? []), name];
            const probed = ctx.store.get(cmd.tool, words);
            if (probed === undefined) {
                const key = `${cmd.tool}|${words.join(" ")}`;
                if (!ctx.pendingKeys.has(key)) {
                    ctx.pendingKeys.add(key);
                    res.pending.push({ tool: cmd.tool, words });
                }
                continue;
            }
            if (probed && sameHelp(leaf, probed)) continue;
        }
        const close = nearest(name, [...known]);
        res.diagnostics.push({
            rule: "flag-unknown",
            severity: "error",
            at: {
                file,
                line: cmd.argLines[j],
                col: cmd.argCols[j],
                endCol: cmd.argCols[j] + name.length,
            },
            message: `${name} not defined by ${[ref.tool, ...(ref.probe ? ref.probe.slice(0, -1) : [])].join(" ")}${close ? ` → did you mean ${close}?` : ""}`,
            spec: ref,
        });
    }
}

function specRef(spec: CliSpec): SpecRef {
    return {
        tool: spec.tool,
        version: spec.version,
        source: spec.source,
        probe: spec.probe,
    };
}

/** Paths that are patterns, not files. */
const TEMPLATE_PATH = /[*?<>{}]|\/$/;

function resolveScript(
    skill: Skill,
    doc: string,
    p: string,
): { target: string; strict: boolean } | undefined {
    if (BASE_PLACEHOLDER.test(p)) {
        return {
            target: path.join(skill.dir, p.replace(BASE_PLACEHOLDER, "")),
            strict: true,
        };
    }
    if (path.isAbsolute(p) || p.startsWith("~") || p.startsWith("$"))
        return undefined;
    const fromDoc = path.resolve(path.dirname(doc), p);
    if (fs.existsSync(fromDoc)) return { target: fromDoc, strict: true };
    const fromRoot = path.resolve(skill.dir, p);
    if (fs.existsSync(fromRoot)) return { target: fromRoot, strict: true };
    // Harness installs may relocate the same skill under .claude/skills/.
    const installed = /^\.claude\/skills\/([^/]+)\/(.+)$/.exec(p);
    if (installed?.[1] === skill.name) {
        return { target: path.resolve(skill.dir, installed[2]), strict: true };
    }
    // An explicit agent runtime cwd resolves remaining relative command paths.
    for (
        let dir = skill.dir;
        path.dirname(dir) !== dir;
        dir = path.dirname(dir)
    ) {
        const instructions = path.join(dir, "agent.md");
        if (!fs.existsSync(instructions)) continue;
        const full = fs.readFileSync(instructions, "utf8");
        if (
            /working directory[^\n]*one level up from `workspace\/`/.test(full)
        ) {
            return { target: path.resolve(dir, "workspace", p), strict: true };
        }
    }
    // Only claim a missing path when its first segment exists in the skill,
    // e.g. "scripts/gone.py" with a scripts/ dir. Others may be repo paths.
    const first = p.replace(/^\.\//, "").split("/")[0];
    const strict =
        p.includes("/") && fs.existsSync(path.join(skill.dir, first));
    return { target: fromRoot, strict };
}

/** `allowed-tools` Bash patterns → predicates; undefined when no Bash allowlist. */
function allowedBash(value: unknown): ((c: Command) => boolean)[] | undefined {
    const items =
        typeof value === "string"
            ? value.split(/,(?![^(]*\))/).map((s) => s.trim())
            : Array.isArray(value)
              ? value.map(String)
              : [];
    const preds: ((c: Command) => boolean)[] = [];
    let sawBash = false;
    for (const item of items) {
        if (item === "Bash") return undefined; // all commands allowed
        const m = /^Bash\((.*)\)$/.exec(item);
        if (!m) continue;
        sawBash = true;
        const pat = m[1].trim();
        const prefix = pat.replace(/:?\*$/, "").trim();
        const exact = !/\*$/.test(pat);
        preds.push((c) =>
            exact
                ? c.raw === prefix
                : c.raw === prefix || c.raw.startsWith(`${prefix} `),
        );
    }
    return sawBash ? preds : undefined;
}
