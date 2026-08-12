// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic generator for docs/overview/command-reference.md.
//
// Unlike the per-package README.AUTOGEN.md flow (LLM-authored), the command
// reference is a mechanical transform of the dispatcher + agent command
// descriptors. It boots a headless, read-only dispatcher context with every
// default agent's commands enabled, then renders each command's Usage /
// Arguments / Flags via the dispatcher's collectCommandReferenceMarkdown().
//
// The heavy agent dependency tree (agent-dispatcher + default-agent-provider)
// is only pulled in by callers that import this module, so the normal
// docs-autogen package flow stays lightweight.

import path from "node:path";
import { promises as fsPromises } from "node:fs";
import { format as prettierFormat } from "prettier";

import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    collectCommandReferenceMarkdown,
    collectActionReference,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultAppAgentSource,
    getMcpAppAgentSource,
} from "default-agent-provider";
import { existsSync } from "node:fs";

// Repo-relative location of the generated reference.
export const COMMAND_REFERENCE_REL_PATH = path.join(
    "docs",
    "overview",
    "command-reference.md",
);

// Intro/header prepended to the generated command sections. Kept here (not in
// the doc) because the whole file is overwritten on every run.
const INTRO = `# TypeAgent Command Reference

> **Auto-generated — do not edit by hand.** This file is produced by
> \`docs-autogen --command-reference\`, which walks the command descriptors
> registered by the dispatcher and each bundled agent. To change a command's
> summary, arguments, or flags, edit its \`CommandDescriptor\` in the agent source
> and regenerate. Extended prose for a command belongs in the README next to the
> code that implements it, not here. See the
> [doc-autogen guide](../contributing/doc-autogen.md#the-command-reference---command-reference).

This is the reference for TypeAgent's \`@\` commands, generated directly from the
command descriptors registered by the dispatcher and the bundled application
agents. Commands without an agent prefix (e.g. \`@config\`) are handled by the
built-in **system** agent; every other agent prefixes its commands with the
agent name (e.g. \`@dispatcher reason\`).

Availability depends on the client (for example, \`@shell\` commands provided by
the desktop shell do not work on the CLI) and on which agents are enabled. Some
clients register additional agents that are not part of the default bundle;
those commands are documented with their respective
[agents](../agents/index.md). Run \`@help\` in any client to list what is
currently available.
`;

// Boot a headless, read-only dispatcher with every default agent's commands
// enabled and render the command reference markdown (intro + one section per
// command). Translation, explanation, and caching are disabled so the boot
// needs no API keys; agents load regardless of missing runtime credentials
// because credentials are only consulted at action-execution time.
export async function generateCommandReferenceMarkdown(
    monorepoRoot: string,
): Promise<string> {
    const instanceDir = getInstanceDir();
    const appAgentProviders = getDefaultAppAgentProviders(instanceDir);
    // The @package management commands are provided by the install source
    // rather than a static provider; include it so they are documented too.
    const appAgentSources = [
        getDefaultAppAgentSource(instanceDir),
        getMcpAppAgentSource(instanceDir),
    ];

    // Resolve each command's declared action to a fully-qualified name and a
    // link to its schema source. Built from the same providers, so it does not
    // depend on which schemas the command context enables. The link is relative
    // to the reference doc's own location.
    const { provider } = await getAllActionConfigProvider(appAgentProviders);
    const actionReference = collectActionReference(provider);
    const docDir = path.dirname(
        path.resolve(monorepoRoot, COMMAND_REFERENCE_REL_PATH),
    );
    const resolveAction = (agentName: string, actionName: string) => {
        const entry = actionReference.get(`${agentName}\n${actionName}`);
        if (entry === undefined) {
            return undefined;
        }
        const qualifiedName = `${entry.schemaName}.${actionName}`;
        if (entry.sourceFile === undefined || !existsSync(entry.sourceFile)) {
            return { qualifiedName };
        }
        const link = path
            .relative(docDir, entry.sourceFile)
            .split(path.sep)
            .join("/");
        return { qualifiedName, link };
    };

    const context = await initializeCommandHandlerContext(
        "docs-command-reference",
        {
            appAgentProviders,
            appAgentSources,
            agents: { actions: false, schemas: false, commands: true },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
        },
    );
    try {
        const body = await collectCommandReferenceMarkdown(context, {
            resolveAction,
        });
        // Format through prettier (markdown parser, repo defaults) so the
        // written file is idempotent and passes the repo's formatting check
        // without a follow-up `prettier --write` pass.
        return await prettierFormat(`${INTRO}\n${body}\n`, {
            parser: "markdown",
        });
    } finally {
        await closeCommandHandlerContext(context);
    }
}

export interface CommandReferenceWriteResult {
    targetPath: string;
    changed: boolean;
}

// Generate the reference and write it under the monorepo root. Returns the
// absolute path and whether the on-disk content changed (so callers can report
// staleness without a separate read).
export async function writeCommandReference(
    monorepoRoot: string,
): Promise<CommandReferenceWriteResult> {
    const markdown = await generateCommandReferenceMarkdown(monorepoRoot);
    const targetPath = path.join(monorepoRoot, COMMAND_REFERENCE_REL_PATH);

    let previous: string | undefined;
    try {
        previous = await fsPromises.readFile(targetPath, "utf8");
    } catch {
        previous = undefined;
    }
    const changed = previous !== markdown;
    if (changed) {
        await fsPromises.writeFile(targetPath, markdown, "utf8");
    }
    return { targetPath, changed };
}
