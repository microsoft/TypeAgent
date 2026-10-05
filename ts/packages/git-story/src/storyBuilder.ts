// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
    CommitContext,
    CommitLink,
    FileAttribution,
    FileEffect,
    GitCommitStory,
    SessionEvent,
    SessionKey,
    SessionStore,
    StagedFile,
} from "./gitCommitStory.js";
import { readStagedFiles, runGit } from "./git.js";
import { writeStory } from "./storyCodec.js";
import { isReadOnlyGitCommand } from "./toolFilter.js";

const EMPTY_BLOB_HASH = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const MAXIMUM_COMMAND_LENGTH = 200;
const MAXIMUM_SNIPPET_LENGTH = 120;
const MAXIMUM_SCRIPT_LENGTH = 200;
const REDACTED = "<redacted>";

export interface IStoryBuildRequest {
    commit: CommitContext;
    store: SessionStore;
    staged?: StagedFile[];
}

export interface IStoryBuildResult {
    story: GitCommitStory;
    commitMessage: string;
    sessions: SessionKey[];
}

type Write = FileEffect & { session: SessionKey; at: string; via?: number };

export class StoryBuilder {
    async build(request: IStoryBuildRequest): Promise<IStoryBuildResult> {
        const staged =
            request.staged ?? readStagedFiles(request.commit.projectPath);
        const link = linkSessions(
            request.commit.projectPath,
            request.store,
            staged,
        );
        const story = toPublicStory(link);
        return {
            story,
            commitMessage: writeStory(request.commit.message, story),
            sessions: link.sessions.map(({ session }) => session),
        };
    }
}

export function linkSessions(
    repository: string,
    store: SessionStore,
    staged: StagedFile[],
): CommitLink {
    const events = new Map<SessionKey, SessionEvent[]>();
    const writes: Write[] = [];
    for (const session of store.sessions()) {
        const sessionEvents = store.events(session, true);
        if (!sessionEvents.length) continue;
        events.set(session, sessionEvents);
        let commandIndex = 0;
        for (const event of sessionEvents) {
            if (event.kind === "command") {
                const publishedCommandIndex = !isReadOnlyGitCommand(
                    event.command,
                )
                    ? commandIndex++
                    : undefined;
                for (const write of event.writes) {
                    writes.push({
                        ...write,
                        session,
                        at: event.at,
                        ...(publishedCommandIndex === undefined
                            ? {}
                            : { via: publishedCommandIndex }),
                    });
                }
            } else if (isFileEffect(event)) {
                writes.push({ ...event, session, at: event.at });
            }
        }
    }
    writes.sort((left, right) => left.at.localeCompare(right.at));

    const stagedPaths = new Set(staged.map(({ path }) => path));
    const attributed = new Map<SessionKey, FileAttribution[]>();
    const uncommitted = new Map<SessionKey, Set<string>>();
    const humanOnly: string[] = [];
    for (const file of staged) {
        const candidates = writes.filter((write) => write.path === file.path);
        if (!candidates.length) {
            humanOnly.push(file.path);
            continue;
        }
        const matching = candidates.filter(
            (write) => writeBlob(write) === file.blob,
        );
        const credited = (matching.length ? matching : candidates).at(-1)!;
        const parent = parentBlob(repository, file.oldPath ?? file.path);
        const counts = numstat(repository, parent, writeBlob(credited));
        const attribution: FileAttribution = {
            kind: file.kind,
            path: file.path,
            ...((file.kind === "rename" || credited.kind === "rename") && {
                oldPath:
                    file.oldPath ??
                    (credited as Extract<Write, { kind: "rename" }>).oldPath,
            }),
            attribution: matching.length ? "agent" : "modified",
            ...(!matching.length && {
                lines: {
                    agentAdded: counts.added,
                    agentRemoved: counts.removed,
                    kept: keptLines(
                        repository,
                        parent,
                        writeBlob(credited),
                        file.blob,
                    ),
                },
            }),
            ...(credited.via === undefined ? {} : { via: credited.via }),
        } as FileAttribution;
        const files = attributed.get(credited.session) ?? [];
        files.push(attribution);
        attributed.set(credited.session, files);
    }

    for (const write of writes) {
        if (stagedPaths.has(write.path)) continue;
        const paths = uncommitted.get(write.session) ?? new Set<string>();
        paths.add(write.path);
        uncommitted.set(write.session, paths);
    }

    return {
        sessions: [...events].flatMap(([session, sessionEvents]) => {
            const files = attributed.get(session) ?? [];
            const pending = [...(uncommitted.get(session) ?? [])];
            const ranCommand = sessionEvents.some(
                (event) => event.kind === "command",
            );
            return files.length || pending.length || ranCommand
                ? [
                      {
                          session,
                          events: sessionEvents,
                          files,
                          uncommitted: pending,
                      },
                  ]
                : [];
        }),
        humanOnly,
    };
}

export function toPublicStory(link: CommitLink): GitCommitStory {
    return {
        version: 2,
        sessions: link.sessions.map(
            ({ session, events, files, uncommitted }) => {
                const commands = events
                    .filter(
                        (
                            event,
                        ): event is Extract<
                            SessionEvent,
                            { kind: "command" }
                        > =>
                            event.kind === "command" &&
                            !isReadOnlyGitCommand(event.command),
                    )
                    .map((event) => ({
                        risk: event.risk,
                        command: publicText(
                            event.command,
                            MAXIMUM_COMMAND_LENGTH,
                        ),
                        ...(event.script
                            ? {
                                  script: redact(event.script.source).slice(
                                      0,
                                      MAXIMUM_SCRIPT_LENGTH,
                                  ),
                              }
                            : {}),
                        writes: event.writes.map(({ path }) => path),
                    }));
                const snippets = new Map<
                    number,
                    { turn: number; prompt: string; reply: string }
                >();
                let lastTurn = 1;
                for (const event of events) {
                    if (event.kind !== "prompt" && event.kind !== "reply")
                        continue;
                    lastTurn = event.kind === "prompt" ? event.turn : lastTurn;
                    const turn = event.kind === "reply" ? lastTurn : event.turn;
                    const snippet = snippets.get(turn) ?? {
                        turn,
                        prompt: "",
                        reply: "",
                    };
                    snippet[event.kind] = publicText(
                        event.text,
                        MAXIMUM_SNIPPET_LENGTH,
                    );
                    snippets.set(turn, snippet);
                }
                const model = [...events]
                    .reverse()
                    .find((event) => event.model)?.model;
                return {
                    session,
                    ...(model ? { model } : {}),
                    turns: new Set(events.map(({ turn }) => turn)).size,
                    files,
                    commands,
                    uncommitted,
                    snippets: [...snippets.values()].filter(
                        ({ prompt, reply }) => prompt || reply,
                    ),
                };
            },
        ),
        humanOnly: link.humanOnly,
    };
}

function isFileEffect(event: SessionEvent): event is SessionEvent & FileEffect {
    return ["create", "edit", "delete", "rename"].includes(event.kind);
}

function writeBlob(write: Write): string | null {
    return write.kind === "delete" ? null : write.blob;
}

function parentBlob(repository: string, filePath: string): string | null {
    const head = runGit(repository, ["rev-parse", "--verify", "HEAD"], true);
    return head
        ? runGit(
              repository,
              ["rev-parse", "--verify", `${head}:${filePath}`],
              true,
          ) || null
        : null;
}

function numstat(
    repository: string,
    before: string | null,
    after: string | null,
): { added: number; removed: number } {
    if (before === after) return { added: 0, removed: 0 };
    const output = diffBlobs(repository, before, after, ["--numstat"]);
    const [added, removed] = output.split(/\s+/, 2);
    return {
        added: added === "-" ? 0 : Number.parseInt(added || "0", 10),
        removed: removed === "-" ? 0 : Number.parseInt(removed || "0", 10),
    };
}

function diffBlobs(
    repository: string,
    before: string | null,
    after: string | null,
    args: string[],
): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), "git-story-diff-"));
    const files = [before, after].map((blob, index) => {
        const file = path.join(directory, String(index));
        const contents = execFileSync("git", [
            "-C",
            repository,
            "cat-file",
            "blob",
            blob ?? EMPTY_BLOB_HASH,
        ]);
        writeFileSync(file, contents);
        return file;
    });
    try {
        return runGit(
            repository,
            ["diff", "--no-index", ...args, ...files],
            true,
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function keptLines(
    repository: string,
    parent: string | null,
    agent: string | null,
    staged: string | null,
): number {
    if (!agent || !staged) return 0;
    const patch = diffBlobs(repository, parent, agent, [
        "--no-color",
        "--unified=0",
    ]);
    const additions = patch
        .split(/\r?\n/)
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1));
    const stagedText = execFileSync(
        "git",
        ["-C", repository, "cat-file", "blob", staged],
        {
            encoding: "utf8",
        },
    );
    const counts = new Map<string, number>();
    for (const line of stagedText.split(/\r?\n/)) {
        counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    let kept = 0;
    for (const line of additions) {
        const count = counts.get(line) ?? 0;
        if (count > 0) {
            kept++;
            counts.set(line, count - 1);
        }
    }
    return kept;
}

const SECRET_PATTERNS: RegExp[] = [
    /(\bauthorization\s*:\s*)(?:bearer|basic)?\s*[^\s"']+/gi,
    /([?&](?:token|api[_-]?key|password|secret|signature)=)[^&\s"']+/gi,
    /\b((?:token|api[_-]?key|password|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi,
    /(--?(?:token|api[_-]?key|password|secret|authorization)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
    /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi,
];

function redact(value: string): string {
    return SECRET_PATTERNS.reduce(
        (text, pattern) =>
            text.replace(
                pattern,
                (_match, prefix?: string) => `${prefix ?? ""}${REDACTED}`,
            ),
        value,
    );
}

function publicText(value: string, length: number): string {
    return redact(value).replace(/\s+/g, " ").trim().slice(0, length);
}
