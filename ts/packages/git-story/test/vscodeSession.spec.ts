// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vscodeSessionRegistration } from "../src/commands/hooks.js";
import { SessionRegistrationSchema } from "../src/daemonApi.js";

// A VS Code SessionStart payload keeps the transcript_path VS Code sent.
test("VS Code SessionStart preserves explicit transcript and registration metadata", () => {
    const repo = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "git-story-")),
    );
    try {
        execFileSync("git", ["init", "-q"], {
            cwd: repo,
            env: {
                ...process.env,
                GIT_CONFIG_GLOBAL: path.join(repo, "gitconfig"),
                GIT_CONFIG_NOSYSTEM: "1",
            },
        });
        const transcript = path.join(repo, "transcripts", "s7.jsonl");
        const registration = vscodeSessionRegistration(
            {
                hook_event_name: "SessionStart",
                session_id: "s7",
                transcript_path: transcript,
            },
            repo,
        );
        const repoStat = fs.statSync(repo);
        const projectStat = fs.statSync(registration.projectPath);
        expect([projectStat.dev, projectStat.ino]).toEqual([
            repoStat.dev,
            repoStat.ino,
        ]);
        expect(SessionRegistrationSchema.parse(registration)).toEqual({
            projectPath: registration.projectPath,
            sessionId: "s7",
            transcriptPath: transcript,
            metadata: { clientName: "vscode-copilot", models: [] },
        });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});
