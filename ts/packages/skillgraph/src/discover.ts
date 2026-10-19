// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Skill } from "./context.js";
import type { Diagnostic } from "./types.js";

// Filesystem discovery: roots → skills, skill dir → files.

export const ENTRY = "SKILL.md";
export const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "__pycache__",
    ".venv",
    "dist",
    "_artifacts",
]);

export function expandHome(p: string): string {
    return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Skills under roots (dir or its children with SKILL.md), deduped by realpath. */
export function discoverSkills(roots: string[]): {
    skills: Skill[];
    aliases: Map<string, Skill>;
    dupes: Diagnostic[];
} {
    const byReal = new Map<string, Skill>();
    const aliases = new Map<string, Skill>();
    const dupes: Diagnostic[] = [];
    for (const r of roots) {
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
                aliases.set(`${root}\0${fm[1]}`, skill);
        }
    }
    const skills = [...byReal.values()];
    for (const skill of skills) {
        if (
            skills.some((other) => other !== skill && other.name === skill.name)
        ) {
            skill.id = skill.entry;
        }
    }
    return { skills, aliases, dupes };
}

function readHead(file: string): string {
    try {
        return fs.readFileSync(file, "utf8").slice(0, 2048);
    } catch {
        return "";
    }
}

/** Files under dir (depth ≤ 4), skipping SKIP_DIRS and dotfiles. */
export function listFiles(dir: string): string[] {
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
