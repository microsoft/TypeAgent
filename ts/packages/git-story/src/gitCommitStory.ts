// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Harness = "copilot-cli" | "vscode";
export type SessionKey = `${Harness}/${string}`;
export type CommandRisk = "run" | "install" | "network" | "destructive";

export type SessionMetadata = {
    clientName: string;
    models: string[];
};

export type EventBase = {
    session: SessionKey;
    turn: number;
    at: string;
    model?: string;
};

export type FileEffect =
    | { kind: "create" | "edit"; path: string; blob: string }
    | { kind: "delete"; path: string }
    | { kind: "rename"; path: string; oldPath: string; blob: string };

export type SessionEvent =
    | (EventBase & { kind: "prompt" | "reply"; text: string })
    | (EventBase & FileEffect)
    | (EventBase & {
          kind: "command";
          command: string;
          risk: CommandRisk;
          exitCode?: number;
          script?: { interpreter: string; source: string };
          writes: FileEffect[];
      });

export type StoryFile = (
    | { kind: "create" | "edit" | "delete"; path: string }
    | { kind: "rename"; path: string; oldPath: string }
) & {
    attribution: "agent" | "modified";
    lines?: {
        agentAdded: number;
        agentRemoved: number;
        kept: number;
    };
    via?: number;
};

export type SessionStory = {
    session: SessionKey;
    model?: string;
    turns: number;
    files: StoryFile[];
    commands: {
        risk: CommandRisk;
        command: string;
        script?: string;
        writes: string[];
    }[];
    uncommitted: string[];
    snippets: { turn: number; prompt: string; reply: string }[];
};

export type GitCommitStory = {
    version: 2;
    sessions: SessionStory[];
    humanOnly: string[];
};

export type CommitContext = {
    projectPath: string;
    // The diff and message describe the exact candidate commit.
    diff: string;
    message: string;
};

export type StagedFile = {
    path: string;
    blob: string | null;
    kind: FileEffect["kind"];
    oldPath?: string;
};

export type FileAttribution = StoryFile;

export type CommitLink = {
    sessions: {
        session: SessionKey;
        events: SessionEvent[];
        files: FileAttribution[];
        uncommitted: string[];
    }[];
    humanOnly: string[];
};

export interface SessionStore {
    append(event: SessionEvent): void;
    sessions(): SessionKey[];
    events(session: SessionKey, sinceCommit?: boolean): SessionEvent[];
    transcriptPath(session: SessionKey): string | undefined;
    markCommitted(session: SessionKey, commit: string, count?: number): void;
}
