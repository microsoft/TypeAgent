// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import type { GitCommitStory } from "../gitCommitStory.js";
import { findRepository, runGit } from "../git.js";
import { readStory } from "../storyCodec.js";

export const showCommand = new Command("show")
    .description("Show the story attached to a commit")
    .argument("[commit]", "commit to inspect", "HEAD")
    .option("--json", "print the v2 JSON payload")
    .action((commit: string, options: { json?: boolean }) => {
        const repository = findRepository(process.cwd());
        if (!repository) throw new Error("Not a Git repository");
        const resolved = runGit(repository, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${commit}^{commit}`,
        ]);
        const fields = runGit(repository, [
            "show",
            "-s",
            "--format=%s%x00%aI%x00%B",
            "--end-of-options",
            resolved,
        ]).split("\0");
        const story = readStory(fields[2]);
        if (!story) {
            process.stdout.write("No commit story.\n");
            return;
        }
        process.stdout.write(
            options.json
                ? `${JSON.stringify(story, undefined, 2)}\n`
                : renderStory(fields[0], resolved, fields[1], story),
        );
    });

function renderStory(
    subject: string,
    sha: string,
    at: string,
    story: GitCommitStory,
): string {
    const lines = [
        `${subject}  ${sha.slice(0, 7)}  ${at.slice(0, 10)}`,
        `${story.sessions.length} session${story.sessions.length === 1 ? "" : "s"}`,
    ];
    for (const session of story.sessions) {
        lines.push(
            `  ${session.session}${session.model ? `  ${session.model}` : ""}  ${session.turns} turn${session.turns === 1 ? "" : "s"}`,
        );
        for (const command of session.commands) {
            lines.push(
                `    ${command.risk.padEnd(11)} ${command.command}${command.writes.length ? `  wrote ${command.writes.join(", ")}` : ""}`,
            );
        }
        for (const file of session.files) {
            const target =
                file.kind === "rename"
                    ? `${file.oldPath} -> ${file.path}`
                    : file.path;
            const counts = file.lines
                ? `  agent +${file.lines.agentAdded} -${file.lines.agentRemoved}, commit keeps ${file.lines.kept}`
                : "";
            lines.push(
                `    ${file.kind.padEnd(7)} ${target}  ${file.attribution}${counts}`,
            );
        }
        if (session.uncommitted.length) {
            lines.push(`    uncommitted ${session.uncommitted.join(", ")}`);
        }
        for (const snippet of session.snippets) {
            lines.push(`    "${snippet.prompt}" -> "${snippet.reply}"`);
        }
    }
    if (story.humanOnly.length) {
        lines.push(`Human-only files: ${story.humanOnly.join(", ")}`);
    }
    return `${lines.join("\n")}\n`;
}
