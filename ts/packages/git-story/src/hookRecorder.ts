// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BaseHookInput } from "@typeagent/agent-harness-hooks/copilot-cli";
import type {
    CommandRisk,
    FileEffect,
    SessionEvent,
    SessionKey,
} from "./gitCommitStory.js";
import {
    diffSnapshots,
    findRepository,
    repositoryPath,
    resolveGitDirectory,
    runGit,
    snapshotWorkingTree,
    type WorkingSnapshot,
} from "./git.js";
import { JsonlSessionStore } from "./sessionStore.js";
import { classifyTool, isReadOnlyGitCommand, ToolClass } from "./toolFilter.js";

export type CopilotHookName =
    | "sessionStart"
    | "userPromptSubmitted"
    | "preToolUse"
    | "postToolUse"
    | "postToolUseFailure"
    | "agentStop"
    | "sessionEnd";

type HookInput = Partial<BaseHookInput> & Record<string, unknown>;
type ToolDetails = { name: string; args: unknown };

export function recordCopilotHook(
    hook: CopilotHookName,
    input: HookInput,
): void {
    try {
        const cwd = stringValue(input.cwd);
        const sessionId = stringValue(input.sessionId);
        const repository = cwd ? findRepository(cwd) : undefined;
        if (!cwd || !sessionId || !repository) return;
        const session = `copilot-cli/${sessionId}` as SessionKey;
        const store = new JsonlSessionStore(resolveGitDirectory(repository));
        const model = stringValue(input.model);
        const common = {
            session,
            turn: turn(store, session, hook),
            at: timestamp(input.timestamp),
            ...(model ? { model } : {}),
        };

        if (hook === "userPromptSubmitted") {
            append(store, {
                ...common,
                kind: "prompt",
                text: stringValue(input.prompt) ?? "",
            });
            return;
        }
        if (hook === "agentStop" || hook === "sessionEnd") {
            if (hook === "sessionEnd") {
                const reply = stringValue(input.finalMessage);
                if (reply)
                    append(store, { ...common, kind: "reply", text: reply });
            }
            const transcript = stringValue(input.transcriptPath);
            if (transcript) store.setTranscriptPath(session, transcript);
            return;
        }
        const details = tool(input);
        if (hook === "preToolUse") {
            if (!details || !shellCommand(details)) return;
            const file = snapshotFile(store, session, details);
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(
                file,
                JSON.stringify(snapshotWorkingTree(repository)),
                {
                    mode: 0o600,
                },
            );
            return;
        }
        if (
            (hook !== "postToolUse" && hook !== "postToolUseFailure") ||
            !details
        )
            return;
        const command = shellCommand(details);
        if (command) {
            const file = snapshotFile(store, session, details);
            let before: WorkingSnapshot = {};
            try {
                before = JSON.parse(
                    readFileSync(file, "utf8"),
                ) as WorkingSnapshot;
            } catch {
                // Missing pre-hook state yields no inferred writes.
            }
            const writes = diffSnapshots(
                before,
                snapshotWorkingTree(repository),
                repository,
            );
            if (!isReadOnlyGitCommand(command) || writes.length) {
                const script = detectScript(command, repository, cwd);
                append(store, {
                    ...common,
                    kind: "command",
                    command,
                    risk: classifyRisk(details.name, command),
                    ...(script ? { script } : {}),
                    writes,
                });
            }
            rmSync(file, { force: true });
            return;
        }
        for (const effect of fileEffects(repository, cwd, details)) {
            append(store, { ...common, ...effect });
        }
    } catch {
        // Capture is observational and must not block Copilot.
    }
}

function append(store: JsonlSessionStore, event: SessionEvent): void {
    try {
        store.append(event);
    } catch {
        // A local write failure must not block Copilot.
    }
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function timestamp(value: unknown): string {
    if (typeof value === "number") return new Date(value).toISOString();
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
        return new Date(value).toISOString();
    }
    return new Date().toISOString();
}

function turn(
    store: JsonlSessionStore,
    session: SessionKey,
    hook: CopilotHookName,
): number {
    const prompts = store
        .events(session)
        .filter(({ kind }) => kind === "prompt").length;
    return hook === "userPromptSubmitted" ? prompts + 1 : Math.max(1, prompts);
}

function tool(input: HookInput): ToolDetails | undefined {
    const name = stringValue(input.toolName);
    if (name) return { name, args: input.toolArgs };
    const calls = input.toolCalls;
    if (!Array.isArray(calls) || calls.length !== 1) return undefined;
    const call = calls[0];
    if (!call || typeof call !== "object") return undefined;
    const value = call as Record<string, unknown>;
    const callName = stringValue(value.name);
    return callName ? { name: callName, args: value.args } : undefined;
}

function shellCommand(details: ToolDetails): string | undefined {
    if (!/^(bash|powershell)$/i.test(details.name)) return undefined;
    return typeof details.args === "string"
        ? details.args
        : details.args && typeof details.args === "object"
          ? stringValue((details.args as Record<string, unknown>).command)
          : undefined;
}

function snapshotFile(
    store: JsonlSessionStore,
    session: SessionKey,
    details?: ToolDetails,
): string {
    const key = `${session}\0${details?.name ?? "tool"}\0${JSON.stringify(details?.args)}`;
    const digest = createHash("sha256").update(key).digest("hex");
    return path.join(store.root, "snapshots", `${digest}.json`);
}

function classifyRisk(toolName: string, command: string): CommandRisk {
    const value = command.toLowerCase();
    if (
        /\b(?:rm\s+-[^\n;|]*r|git\s+reset\s+--hard|git\s+push\b[^\n;|]*(?:--force|-f\b)|git\s+clean\s+-[^\n;|]*f)\b/.test(
            value,
        )
    ) {
        return "destructive";
    }
    if (
        /\b(?:(?:npm|pnpm|yarn)\s+(?:i|install|add)|pip(?:3)?\s+install|code\s+--install-extension)\b/.test(
            value,
        )
    ) {
        return "install";
    }
    if (/\b(?:curl|wget|git\s+clone)\b/.test(value)) return "network";
    const classification = classifyTool(toolName.toLowerCase(), command);
    return classification === ToolClass.Block ? "destructive" : "run";
}

function fileEffects(
    repository: string,
    cwd: string,
    details: ToolDetails,
): FileEffect[] {
    const args =
        details.args && typeof details.args === "object"
            ? (details.args as Record<string, unknown>)
            : {};
    const patch =
        typeof details.args === "string"
            ? details.args
            : stringValue(args.patch);
    if (patch && details.name.toLowerCase() === "apply_patch") {
        return patchEffects(repository, cwd, patch);
    }
    const rawPath =
        stringValue(args.file_path) ??
        stringValue(args.filePath) ??
        stringValue(args.path) ??
        stringValue(args.target);
    if (!rawPath) return [];
    const filePath = repositoryPath(repository, cwd, rawPath);
    if (!filePath) return [];
    if (/delete/i.test(details.name))
        return [{ kind: "delete", path: filePath }];
    const blob = runGit(
        repository,
        ["hash-object", "-w", "--", filePath],
        true,
    );
    if (!blob) return [];
    const rawOldPath = stringValue(args.oldPath) ?? stringValue(args.old_path);
    const oldPath = rawOldPath
        ? repositoryPath(repository, cwd, rawOldPath)
        : undefined;
    if (/rename|move/i.test(details.name) && oldPath) {
        return [{ kind: "rename", path: filePath, oldPath, blob }];
    }
    const tracked = Boolean(
        runGit(
            repository,
            ["ls-files", "--error-unmatch", "--", filePath],
            true,
        ),
    );
    return [
        {
            kind:
                tracked || /edit|replace|notebook/i.test(details.name)
                    ? "edit"
                    : "create",
            path: filePath,
            blob,
        },
    ];
}

function patchEffects(
    repository: string,
    cwd: string,
    patch: string,
): FileEffect[] {
    const effects: FileEffect[] = [];
    const lines = patch.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(
            lines[index],
        );
        if (!match) continue;
        const [, action, rawPath] = match;
        const oldPath = repositoryPath(repository, cwd, rawPath);
        if (!oldPath) continue;
        const move = /^\*\*\* Move to: (.+)$/.exec(lines[index + 1] ?? "");
        const filePath = move
            ? repositoryPath(repository, cwd, move[1])
            : oldPath;
        if (!filePath) continue;
        if (action === "Delete") {
            effects.push({ kind: "delete", path: oldPath });
            continue;
        }
        const blob = runGit(
            repository,
            ["hash-object", "-w", "--", filePath],
            true,
        );
        if (!blob) continue;
        effects.push(
            move
                ? { kind: "rename", path: filePath, oldPath, blob }
                : {
                      kind: action === "Add" ? "create" : "edit",
                      path: filePath,
                      blob,
                  },
        );
    }
    return effects;
}

function detectScript(
    command: string,
    repository: string,
    cwd: string,
): Extract<SessionEvent, { kind: "command" }>["script"] {
    const inline =
        /^\s*(python(?:3)?|node|bash|sh)\s+(?:-[ec]\s+)(["'])([\s\S]*)\2\s*$/.exec(
            command,
        );
    if (inline) return { interpreter: inline[1], source: inline[3] };
    const heredoc =
        /^\s*(python(?:3)?|node|bash|sh)\b[^\n]*<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*\n([\s\S]*?)\n\2\s*$/.exec(
            command,
        );
    if (heredoc) return { interpreter: heredoc[1], source: heredoc[3] };
    const file = /^\s*(python(?:3)?|node|bash|sh)\s+([^\s;&|]+)/.exec(command);
    if (!file) return undefined;
    const filePath = repositoryPath(
        repository,
        cwd,
        file[2].replace(/^["']|["']$/g, ""),
    );
    if (!filePath) return undefined;
    try {
        return {
            interpreter: file[1],
            source: readFileSync(path.join(repository, filePath), "utf8"),
        };
    } catch {
        // Missing or unreadable script source is omitted.
    }
    return undefined;
}
