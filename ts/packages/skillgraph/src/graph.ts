// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import { countTokens } from "gpt-tokenizer";
import { parseMarkdown } from "./markdown.js";
import {
    type BuildContext,
    type BuildResult,
    type Skill,
    rel,
} from "./context.js";
import { discoverSkills, listFiles } from "./discover.js";
import { commandEdges, MAX_SUBCOMMAND_DEPTH } from "./rules/commands.js";
import { checkFrontmatter } from "./rules/frontmatter.js";
import { linkEdges } from "./rules/links.js";
import { checkOrphans } from "./rules/orphans.js";
import { skillEdges } from "./rules/skills.js";
import { resetWhich } from "./specs/process.js";
import { SpecStore } from "./specs/store.js";
import type { Config, Diagnostic, GraphNode } from "./types.js";
import { runLimited } from "./util.js";

// Builds the skill graph and its diagnostics from disk (plus editor overlays).
//
//   roots ─▶ skills (dirs with SKILL.md, deduped by realpath)
//        ─▶ docs (*.md) ─▶ links / skill:// / commands
//        ─▶ edges + diagnostics; external tools resolved via SpecStore
//
// `build()` never runs a tool. It reports `spec-pending` and returns the
// probes it needs; callers run them (CLI: await, LSP: background) and rebuild.
//
// Modules: discover.ts (fs) · rules/* (one diagnostic family each) ·
// specs/* (script AST, --help parsing, probing, cache) · shell.ts (commands).

export type { BuildResult, Probe, Skill } from "./context.js";
export { expandHome } from "./discover.js";

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
        const { skills, aliases, dupes } = discoverSkills(this.config.roots);
        this.aliases = aliases;
        return { skills, dupes };
    }

    build(scope?: string): BuildResult {
        resetWhich();
        const { skills, dupes } = this.discover();
        const res: BuildResult = {
            nodes: [],
            edges: [],
            diagnostics: [...dupes],
            skills,
            pending: [],
            docs: new Map(),
            specs: new Map(),
        };
        const ctx: BuildContext = {
            config: this.config,
            store: this.store,
            read: (f) => this.read(f),
            hasOverlay: (f) => this.overlays.has(f),
            aliases: this.aliases,
            byName: new Map(skills.map((s) => [`${s.root}\0${s.name}`, s])),
            pendingKeys: new Set(),
        };
        for (const skill of skills) {
            if (scope && skill.name !== scope) continue;
            this.buildSkill(ctx, skill, res);
        }
        return res;
    }

    private buildSkill(ctx: BuildContext, skill: Skill, res: BuildResult) {
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
            const docId = isEntry ? skillId : `doc:${rel(skill, file)}`;
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
                    id: `heading:${rel(skill, file)}#${h.slug}`,
                    kind: "heading",
                    path: file,
                    line: h.line,
                });
            }
            if (isEntry) checkFrontmatter(skill, md, res);
            linkEdges(ctx, skill, file, docId, md, res, referenced);
            skillEdges(ctx, skill, file, docId, md, res);
            commandEdges(ctx, skill, file, docId, md, res, referenced);
        }
        checkOrphans(skill, files, mentionText, referenced, res);
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
