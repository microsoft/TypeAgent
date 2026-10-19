// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { countTokens } from "gpt-tokenizer";
import { parseMarkdown, type ParsedMarkdown } from "./markdown.js";
import { commandsFromCode, type Command } from "./shell.js";
import { resetWhich, scriptSpec, SpecStore, which } from "./specs.js";
import type {
    CliSpec,
    Config,
    Diagnostic,
    Edge,
    GraphNode,
    Loc,
    SpecRef,
} from "./types.js";

// Builds the skill graph and its diagnostics from disk (plus editor overlays).
//
//   roots ─▶ skills (dirs with SKILL.md, deduped by realpath)
//        ─▶ docs (*.md) ─▶ links / skill:// / commands
//        ─▶ edges + diagnostics; external tools resolved via SpecStore
//
// `build()` never runs a tool. It reports `spec-pending` and returns the
// probes it needs; callers run them (CLI: await, LSP: background) and rebuild.

const ENTRY = "SKILL.md";
const DESCRIPTION_MAX = 1024;
const MAX_SUBCOMMAND_DEPTH = 3;
const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "dist",
    "_artifacts",
]);
const SCRIPT_EXT = /\.(py|js|mjs|cjs|ts|mts|sh|bash|zsh|rb|pl)$/;
/** Files that are never orphans. */
const NOT_ORPHAN =
    /^(SKILL\.md|LICENSE.*|README.*|AGENTS\.md|CLAUDE\.md|\..*|package(-lock)?\.json|pnpm-lock\.yaml|requirements.*\.txt|pyproject\.toml|tsconfig.*\.json|.*\.lock)$/i;
/** Skill-root placeholders used in script paths, e.g. "{baseDir}/scripts/x.py". */
const BASE_PLACEHOLDER =
    /^(?:\{baseDir\}|\$\{?CLAUDE_SKILL_DIR\}?|\$\{?SKILL_DIR\}?|<skill[-_ ]?dir>)\//;
/** Subcommand words we are willing to append to a `--help` probe. */
const SUBCOMMAND_WORD = /^[a-z][a-z0-9-]*$/;
/** Arguments after these belong to another program (open --args, ssh host cmd). */
const PASSTHROUGH = new Set(["--", "--args"]);
/** Flags nearly every CLI accepts even when help omits them. */
const UNIVERSAL_FLAGS = new Set(["--help", "--version"]);

export interface Skill {
    name: string;
    dir: string;
    entry: string;
    root: string;
    /** Unique graph identity; same names in separate roots remain separate. */
    id: string;
}

export interface Probe {
    tool: string;
    words: string[];
}

export interface BuildResult {
    nodes: GraphNode[];
    edges: Edge[];
    diagnostics: Diagnostic[];
    skills: Skill[];
    pending: Probe[];
    /** Parsed docs by absolute path, for LSP lookups. */
    docs: Map<string, ParsedMarkdown>;
    /** Resolved specs by edge target id + words, for hover/definition. */
    specs: Map<string, CliSpec>;
}

export function expandHome(p: string): string {
    return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export class SkillGraph {
    readonly store: SpecStore;
    private overlays = new Map<string, string>();
    private aliases = new Map<string, Skill>();
    constructor(
        readonly config: Config,
        store?: SpecStore,
    ) {
        this.store = store ?? new SpecStore();
    }

    /** Editor buffer contents override disk. */
    setOverlay(file: string, text: string | undefined) {
        if (text === undefined) this.overlays.delete(file);
        else this.overlays.set(file, text);
    }

    private read(file: string): string | undefined {
        const o = this.overlays.get(file);
        if (o !== undefined) return o;
        try {
            return fs.readFileSync(file, "utf8");
        } catch {
            return undefined;
        }
    }

    discover(): { skills: Skill[]; dupes: Diagnostic[] } {
        const byReal = new Map<string, Skill>();
        this.aliases.clear();
        const dupes: Diagnostic[] = [];
        for (const r of this.config.roots) {
            const root = path.resolve(expandHome(r));
            const candidates: string[] = [];
            if (fs.existsSync(path.join(root, ENTRY))) candidates.push(root);
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(root, { withFileTypes: true });
            } catch {}
            for (const e of entries) {
                const dir = path.join(root, e.name);
                if (SKIP_DIRS.has(e.name)) continue;
                if (fs.existsSync(path.join(dir, ENTRY))) candidates.push(dir);
            }
            for (const dir of candidates.sort()) {
                let real: string;
                try {
                    real = fs.realpathSync(dir);
                } catch {
                    continue;
                }
                if (byReal.has(real)) continue; // same skill via symlinked root
                const skill: Skill = {
                    name: path.basename(dir),
                    dir,
                    entry: path.join(dir, ENTRY),
                    root,
                    id: path.basename(dir),
                };
                byReal.set(real, skill);
                // Roots are separate load scopes; a repository scan must validate every copy.
                // Also resolve by frontmatter name ("_foo/" dir, name: foo).
                const fm = /^---\n[\s\S]*?^name:\s*["']?([\w.-]+)/m.exec(
                    readHead(skill.entry),
                );
                if (fm && fm[1] !== skill.name)
                    this.aliases.set(`${root}\0${fm[1]}`, skill);
            }
        }
        const skills = [...byReal.values()];
        for (const skill of skills) {
            if (
                skills.some(
                    (other) => other !== skill && other.name === skill.name,
                )
            ) {
                skill.id = skill.entry;
            }
        }
        return { skills, dupes };
    }

    build(scope?: string): BuildResult {
        resetWhich();
        const { skills, dupes } = this.discover();
        const byName = new Map(skills.map((s) => [`${s.root}\0${s.name}`, s]));
        const res: BuildResult = {
            nodes: [],
            edges: [],
            diagnostics: [...dupes],
            skills,
            pending: [],
            docs: new Map(),
            specs: new Map(),
        };
        const pendingKeys = new Set<string>();
        for (const skill of skills) {
            if (scope && skill.name !== scope) continue;
            this.buildSkill(skill, byName, res, pendingKeys);
        }
        return res;
    }

    private rel(skill: Skill, file: string) {
        return `${skill.id}/${path.relative(skill.dir, file).split(path.sep).join("/")}`;
    }

    private buildSkill(
        skill: Skill,
        byName: Map<string, Skill>,
        res: BuildResult,
        pendingKeys: Set<string>,
    ) {
        const files = listFiles(skill.dir);
        const mdFiles = files.filter((f) => f.endsWith(".md"));
        const referenced = new Set<string>([skill.entry]);
        // Assets can be loaded by HTML, PowerShell, or other non-Markdown files.
        const mentionText = files.map((f) => this.read(f) ?? "");
        const skillId = `skill:${skill.id}`;

        for (const file of mdFiles) {
            const text = this.read(file);
            if (text === undefined) continue;
            const md = parseMarkdown(text);
            res.docs.set(file, md);
            const isEntry = file === skill.entry;
            const docId = isEntry ? skillId : `doc:${this.rel(skill, file)}`;
            const node: GraphNode = {
                id: docId,
                kind: isEntry ? "skill" : "doc",
                path: file,
                tokens: countTokens(text),
            };
            if (isEntry && typeof md.frontmatter?.description === "string") {
                node.description = md.frontmatter.description;
            }
            res.nodes.push(node);
            for (const h of md.headings) {
                res.nodes.push({
                    id: `heading:${this.rel(skill, file)}#${h.slug}`,
                    kind: "heading",
                    path: file,
                    line: h.line,
                });
            }
            if (isEntry) this.checkFrontmatter(skill, md, res);
            this.linkEdges(skill, file, docId, md, res, referenced);
            this.skillEdges(skill, file, docId, md, byName, res);
            this.commandEdges(
                skill,
                file,
                docId,
                md,
                res,
                referenced,
                pendingKeys,
            );
        }

        // Orphans: files nothing links to, invokes, or names (info only —
        // scripts load assets through string literals we don't model).
        for (const f of files) {
            if (referenced.has(f)) continue;
            const base = path.basename(f);
            if (NOT_ORPHAN.test(base)) continue;
            if (mentionText.some((t, i) => files[i] !== f && t.includes(base)))
                continue;
            // Test runners discover tests without a document linking to them.
            if (
                /(?:^|[/\\])tests?[/\\]|(?:[.]Tests[.]ps1|[.](?:spec|test)[.][cm]?[jt]s)$/.test(
                    path.relative(skill.dir, f),
                )
            )
                continue;
            res.diagnostics.push({
                rule: "orphan",
                severity: "info",
                at: { file: f, line: 1, col: 1, endCol: 1 },
                message: `${this.rel(skill, f)} is not referenced by any doc or script`,
            });
        }
    }

    private checkFrontmatter(
        skill: Skill,
        md: ParsedMarkdown,
        res: BuildResult,
    ) {
        const at = (line = 1): Loc => ({
            file: skill.entry,
            line,
            col: 1,
            endCol: 4,
        });
        const push = (
            rule: string,
            severity: Diagnostic["severity"],
            message: string,
            line = 1,
        ) => res.diagnostics.push({ rule, severity, at: at(line), message });
        if (md.frontmatterError)
            return push("frontmatter-invalid", "error", md.frontmatterError);
        const fm = md.frontmatter;
        if (!fm)
            return push(
                "frontmatter-missing",
                "error",
                "SKILL.md has no YAML frontmatter",
            );
        const lineOf = (key: string) => {
            const i = md.text
                .split("\n")
                .findIndex((l) => l.startsWith(`${key}:`));
            return i >= 0 ? i + 1 : 1;
        };
        if (typeof fm.name !== "string")
            push("name-missing", "error", "frontmatter has no `name`");
        else if (fm.name !== skill.name) {
            push(
                "name-mismatch",
                "warn",
                `name "${fm.name}" does not match directory "${skill.name}"`,
                lineOf("name"),
            );
        }
        if (typeof fm.description !== "string" || !fm.description.trim()) {
            push(
                "description-missing",
                "error",
                "frontmatter has no `description`",
            );
        } else if (fm.description.length > DESCRIPTION_MAX) {
            push(
                "description-too-long",
                "warn",
                `${fm.description.length} > ${DESCRIPTION_MAX} chars`,
                lineOf("description"),
            );
        }
    }

    private linkEdges(
        skill: Skill,
        file: string,
        docId: string,
        md: ParsedMarkdown,
        res: BuildResult,
        referenced: Set<string>,
    ) {
        for (const l of md.links) {
            // External URLs and site-root links ("/docs/en/x" in mirrored docs).
            if (/^[a-z][a-z0-9+.-]*:/i.test(l.url) || l.url.startsWith("/"))
                continue;
            if (/[<>{}$*]/.test(l.url)) continue; // templates and globs
            const at: Loc = {
                file,
                line: l.line,
                col: l.col,
                endCol: l.endCol,
            };
            const [rawPath, anchor] = splitAnchor(l.url);
            const target = rawPath
                ? path.resolve(path.dirname(file), decodeURIComponent(rawPath))
                : file;
            if (!fs.existsSync(target) && !this.overlays.has(target)) {
                res.edges.push({
                    from: docId,
                    to: `file:${target}`,
                    kind: "links",
                    at,
                    resolved: false,
                });
                res.diagnostics.push({
                    rule: "link-broken",
                    severity: "error",
                    at,
                    message: `${rawPath} does not exist`,
                });
                continue;
            }
            referenced.add(target);
            const inSkill =
                target.startsWith(skill.dir + path.sep) || target === skill.dir;
            const targetId =
                target === skill.entry
                    ? `skill:${skill.id}`
                    : inSkill
                      ? `${target.endsWith(".md") ? "doc" : SCRIPT_EXT.test(target) ? "script" : "asset"}:${this.rel(skill, target)}`
                      : `file:${target}`;
            if (anchor && target.endsWith(".md")) {
                const text = this.read(target) ?? "";
                const headings = (target === file ? md : parseMarkdown(text))
                    .headings;
                const ok = headings.some(
                    (h) => h.slug === anchor.toLowerCase(),
                );
                res.edges.push({
                    from: docId,
                    to: `heading:${inSkill ? this.rel(skill, target) : target}#${anchor}`,
                    kind: "links",
                    at,
                    resolved: ok,
                });
                if (!ok) {
                    const have = headings
                        .slice(0, 6)
                        .map((h) => `#${h.slug}`)
                        .join(", ");
                    res.diagnostics.push({
                        rule: "anchor-missing",
                        severity: "error",
                        at,
                        message: `#${anchor} not found in ${rawPath || path.basename(file)}${have ? ` (have: ${have})` : ""}`,
                    });
                }
            } else {
                res.edges.push({
                    from: docId,
                    to: targetId,
                    kind: "links",
                    at,
                    resolved: true,
                });
            }
        }
    }

    private skillEdges(
        skill: Skill,
        file: string,
        docId: string,
        md: ParsedMarkdown,
        byName: Map<string, Skill>,
        res: BuildResult,
    ) {
        for (const r of md.skillRefs) {
            const at: Loc = {
                file,
                line: r.line,
                col: r.col,
                endCol: r.endCol,
            };
            const localKey = `${skill.root}\0${r.name}`;
            const matches = [
                ...byName.values(),
                ...this.aliases.values(),
            ].filter(
                (s) =>
                    s.name === r.name ||
                    this.aliases.get(`${s.root}\0${r.name}`) === s,
            );
            const unique = [...new Set(matches)];
            const target =
                byName.get(localKey) ??
                this.aliases.get(localKey) ??
                (unique.length === 1 ? unique[0] : undefined);
            const ok = target !== undefined;
            res.edges.push({
                from: docId,
                to: `skill:${target?.id ?? r.name}`,
                kind: "uses",
                at,
                resolved: ok,
            });
            if (!ok) {
                res.diagnostics.push({
                    rule: "skill-unknown",
                    severity: "error",
                    at,
                    message: `skill://${r.name} not found in configured roots`,
                });
            }
        }
    }

    private commandEdges(
        skill: Skill,
        file: string,
        docId: string,
        md: ParsedMarkdown,
        res: BuildResult,
        referenced: Set<string>,
        pendingKeys: Set<string>,
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
                    !this.store.isProbeable(cmd.tool)
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
                    this.scriptCall(
                        skill,
                        file,
                        docId,
                        cmd,
                        at,
                        res,
                        referenced,
                    );
                } else {
                    this.toolCall(docId, cmd, at, res, pendingKeys);
                }
            }
        }
    }

    private scriptCall(
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
            path.relative(skill.dir, path.dirname(file)).split(path.sep)
                .length > 1
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
                    to: `script:${this.rel(skill, target)}`,
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
        const id = `script:${this.rel(skill, target)}`;
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
            tool: this.rel(skill, target),
            version: spec.version,
            source: "ast",
        };
        this.checkFlags(cmd, 0, spec, [spec], ref, file, res);
    }

    private toolCall(
        docId: string,
        cmd: Command,
        at: Loc,
        res: BuildResult,
        pendingKeys: Set<string>,
    ) {
        const id = `tool:${cmd.tool}`;
        if (!this.store.isProbeable(cmd.tool)) {
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
            const spec = this.store.get(cmd.tool, words);
            if (spec === undefined) {
                const key = `${cmd.tool}|${words.join(" ")}`;
                if (this.config.probe && !pendingKeys.has(key)) {
                    pendingKeys.add(key);
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
                if (this.config.probe) {
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
                const child = this.store.get(cmd.tool, [...words, next]);
                if (child === undefined) {
                    const key = `${cmd.tool}|${[...words, next].join(" ")}`;
                    if (this.config.probe && !pendingKeys.has(key)) {
                        pendingKeys.add(key);
                        res.pending.push({
                            tool: cmd.tool,
                            words: [...words, next],
                        });
                    }
                    if (this.config.probe) {
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
            this.checkFlags(cmd, i, leaf, chain, specRef(leaf), at.file, res);
        }
    }

    /** Flag names in `cmd.args[from..]` must exist in the spec chain. */
    private checkFlags(
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
        if (![...known].some((n) => n.startsWith("--") && n !== "--help"))
            return;
        for (let j = from; j < cmd.args.length; j++) {
            const a = cmd.args[j];
            if (PASSTHROUGH.has(a)) break;
            if (cmd.opaque.has(j) || !/^--?[A-Za-z]/.test(a)) continue;
            const name = a.split("=")[0];
            if (!name.startsWith("--") && name.length > 2) continue; // -abc bundles
            // Help text often omits short flags (git log -n); only claim long ones.
            if (leaf.source === "help" && !name.startsWith("--")) continue;
            if (known.has(name) || UNIVERSAL_FLAGS.has(name)) continue;
            if (name.startsWith("--no-") && known.has(`--${name.slice(5)}`))
                continue;
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

    /** Run pending probes, then rebuild until no new probes appear. */
    async buildWithProbes(scope?: string): Promise<BuildResult> {
        let res = this.build(scope);
        for (
            let round = 0;
            round <= 2 * MAX_SUBCOMMAND_DEPTH + 1 && res.pending.length;
            round++
        ) {
            await runLimited(res.pending, 8, (p) =>
                this.store.probe(p.tool, p.words),
            );
            res = this.build(scope);
        }
        return res;
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

/** Resolve a script path from the doc dir, then the skill root. */
/** Same help text, or same parsed shape (help with probed words echoed back). */
function sameHelp(a: CliSpec, b: CliSpec): boolean {
    if (a.helpHash === b.helpHash) return true;
    const shape = (s: CliSpec) =>
        JSON.stringify([s.subcommands, s.flags.map((f) => f.name)]);
    return shape(a) === shape(b);
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

function readHead(file: string): string {
    try {
        return fs.readFileSync(file, "utf8").slice(0, 2048);
    } catch {
        return "";
    }
}

function splitAnchor(url: string): [string, string | undefined] {
    const i = url.indexOf("#");
    return i < 0 ? [url, undefined] : [url.slice(0, i), url.slice(i + 1)];
}

function listFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string, depth: number) => {
        if (depth > 4) return;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p, depth + 1);
            else if (e.isFile()) out.push(p);
        }
    };
    walk(dir, 0);
    return out.sort();
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

function nearest(word: string, options: string[]): string | undefined {
    let best: string | undefined;
    let bestD = Math.max(2, Math.floor(word.length / 3)) + 1;
    for (const o of options) {
        const d = levenshtein(word, o);
        if (d < bestD) {
            best = o;
            bestD = d;
        }
    }
    return best;
}

function levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            prev = tmp;
        }
    }
    return dp[b.length];
}

async function runLimited<T>(
    items: T[],
    limit: number,
    fn: (t: T) => Promise<unknown>,
) {
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) await fn(items[next++]);
        }),
    );
}
