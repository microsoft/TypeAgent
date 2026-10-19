// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import type { ParsedMarkdown } from "./markdown.js";
import type { SpecStore } from "./specs/store.js";
import type { CliSpec, Config, Diagnostic, Edge, GraphNode } from "./types.js";

// Shared build types. Rules receive a BuildContext and append to BuildResult.

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

/** Read-only view of the graph that rules need. */
export interface BuildContext {
    config: Config;
    store: SpecStore;
    /** Editor overlay, else disk; undefined when unreadable. */
    read(file: string): string | undefined;
    hasOverlay(file: string): boolean;
    /** Frontmatter-name aliases keyed by `${root}\0${name}`. */
    aliases: Map<string, Skill>;
    /** Skills keyed by `${root}\0${dirName}`. */
    byName: Map<string, Skill>;
    /** Probe keys already queued this build, e.g. "gh|pr view". */
    pendingKeys: Set<string>;
}

/** Graph id path for a file inside a skill, e.g. "review/scripts/x.py". */
export function rel(skill: Skill, file: string) {
    return `${skill.id}/${path.relative(skill.dir, file).split(path.sep).join("/")}`;
}
