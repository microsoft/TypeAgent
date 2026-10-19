// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Core contract shared by the CLI, the LSP, and agents (`--json`).
//
//   SKILL.md ──links──▶ references/x.md#anchor
//      │  └──uses────▶ skill://other
//      └──invokes───▶ scripts/fetch.py  (flags checked against static spec)
//      └──invokes───▶ gh pr view        (flags checked against --help probe)

/** 1-based line/column position inside a file (absolute path). */
export interface Loc {
    file: string;
    line: number;
    col: number;
    endCol: number;
}

export type NodeKind =
    | "skill"
    | "doc"
    | "heading"
    | "script"
    | "tool"
    | "asset";
export type EdgeKind = "links" | "uses" | "invokes";

export interface GraphNode {
    id: string;
    kind: NodeKind;
    /** Absolute path for files; undefined for external tools. */
    path?: string;
    line?: number;
    /** Approximate cl100k token count for docs and skills. */
    tokens?: number;
    description?: string;
}

export interface Edge {
    from: string;
    to: string;
    kind: EdgeKind;
    at: Loc;
    resolved: boolean;
    /** Flags used at an invocation site, e.g. ["--pr", "--since"]. */
    flags?: string[];
    /** For tool edges: subcommand words, e.g. ["pr", "view"]. */
    words?: string[];
}

export type Severity = "error" | "warn" | "info";

/** Where a CLI spec came from; printed on every CLI diagnostic. */
export interface SpecRef {
    tool: string;
    version: string;
    source: "ast" | "help";
    probe?: string[];
}

export interface Diagnostic {
    rule: string;
    severity: Severity;
    at: Loc;
    message: string;
    spec?: SpecRef;
}

/** A known flag plus where it was defined (script line or help text). */
export interface FlagDef {
    name: string;
    line?: number;
    help?: string;
}

/** Normalized CLI surface for one command level. */
export interface CliSpec {
    tool: string;
    version: string;
    source: "ast" | "help";
    probe: string[];
    /** Absolute path of the bundled script, for AST specs. */
    path?: string;
    summary?: string;
    flags: FlagDef[];
    subcommands: string[];
    /** True when help shows a subcommand slot, so unknown words are errors. */
    expectsSubcommand: boolean;
    /** Help says it lists only some options (e.g. curl "--help all"). */
    partial?: boolean;
    /** Hash of the help output; a child equal to its parent is not a real subcommand. */
    helpHash?: string;
}

export interface Config {
    roots: string[];
    /** Run `--help` / `--version` probes for external tools. */
    probe: boolean;
}
