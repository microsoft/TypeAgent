// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome, SKIP_DIRS } from "./discover.js";
import type { Config } from "./types.js";

// .skillgraphrc.json at the repo root. All fields optional.
//
//   {
//     "roots": ["src/agents/**/skills"],     // added to DEFAULT_ROOTS; globs ok
//     "rules": { "orphan": "off", "tool-unknown": "warn" },
//     "probe": true,
//     "maxSkillTokens": 5000,                // skill-too-large
//     "allowDiverged": ["reach-crown-jewel"] // skill-diverged exemptions
//   }
//
//   cwd ─walk up─▶ first dir with .skillgraphrc.json or .git = repo
//       ─▶ roots = DEFAULT_ROOTS ∪ rc.roots (existing dirs only)
//       ─▶ none found? ~/.config/skillshare/skills

export const RC_FILE = ".skillgraphrc.json";
export const DEFAULT_ROOTS = [
    ".agents/skills",
    ".claude/skills",
    ".github/skills",
];
const FALLBACK_ROOT = "~/.config/skillshare/skills";

export interface RcFile {
    roots?: string[];
    rules?: Config["rules"];
    probe?: boolean;
    maxSkillTokens?: number;
    allowDiverged?: string[];
}

/** Repo root for `dir`: nearest ancestor with .skillgraphrc.json, else .git. */
export function findRepo(dir: string): string | undefined {
    let git: string | undefined;
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, RC_FILE))) return d;
        if (!git && fs.existsSync(path.join(d, ".git"))) git = d;
        if (path.dirname(d) === d) return git;
    }
}

export function readRc(repo: string): RcFile {
    const file = path.join(repo, RC_FILE);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")) as RcFile;
}

/** Roots from CLI flags win; otherwise defaults plus .skillgraphrc.json roots. */
export function loadConfig(opts: {
    cwd: string;
    roots?: string[] | undefined;
    probe?: boolean | undefined;
}): Config {
    const repo = findRepo(opts.cwd);
    const rc = repo ? readRc(repo) : {};
    const probe = opts.probe ?? rc.probe ?? true;
    if (opts.roots?.length) {
        const roots = opts.roots.map((r) =>
            path.resolve(opts.cwd, expandHome(r)),
        );
        return withRules({ roots, probe }, rc);
    }
    const roots = repo
        ? [...DEFAULT_ROOTS, ...(rc.roots ?? [])].flatMap((r) =>
              expandRoot(repo, r),
          )
        : [];
    return withRules(
        {
            roots: roots.length
                ? [...new Set(roots)]
                : [expandHome(FALLBACK_ROOT)],
            probe,
        },
        rc,
    );
}

function withRules(config: Config, rc: RcFile): Config {
    if (rc.rules) config.rules = rc.rules;
    if (rc.maxSkillTokens) config.maxSkillTokens = rc.maxSkillTokens;
    if (rc.allowDiverged) config.allowDiverged = rc.allowDiverged;
    return config;
}

/** "src/**\/skills" → matching dirs under repo; plain paths must exist. */
function expandRoot(repo: string, root: string): string[] {
    const abs = path.resolve(repo, expandHome(root));
    if (!/[*?[{]/.test(root)) return fs.existsSync(abs) ? [abs] : [];
    return fs
        .globSync(path.relative(repo, abs), {
            cwd: repo,
            exclude: (d: string) => SKIP_DIRS.has(path.basename(d)),
        })
        .map((m) => path.join(repo, m))
        .filter((m) => fs.statSync(m).isDirectory())
        .sort();
}
