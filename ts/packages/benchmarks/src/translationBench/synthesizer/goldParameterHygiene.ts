// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gold-parameter hygiene for the translation-bench synthesizer harness.
 *
 * These keys must not appear in labeled expectedActions parameters: they are
 * optional defaults, empty placeholders, dual fields, or runtime context that
 * gold should omit rather than mint. This is dataset quality — not paramScore
 * verify=ignore.
 */

export const OMIT_FROM_GOLD_PARAMETERS = [
    "browser.openSearchResult.url",
    "code.code-debug.startDebugging.noDebug",
    "code.code-editor.launchCopilotChat.attachFiles",
    "code.code-editor.launchCopilotChat.isPartialQuery",
    "code.code-editor.saveAllFiles.onlyDirty",
    "code.code-editor.saveCurrentFile.excludeUntitled",
    "code.code-editor.saveCurrentFile.showErrorIfNoActiveEditor",
    "code.code-workbench.openInIntegratedTerminal.reuseExistingTerminal",
    "code.code-workbench.workbenchCreateFolderFromExplorer.resolutionHint",
    "code.code-workbench.workbenchOpenFile.extensions",
    "code.code-workbench.workbenchOpenFile.includeGenerated",
    "code.code-workbench.workbenchOpenFile.matchStrategy",
    "code.launchCopilotChat.attachFiles",
    "code.launchCopilotChat.isPartialQuery",
    "desktop.ApplyTheme.themeName",
    "desktop.RestartService.elevate",
    "desktop.desktop-input.MouseCursorSpeed.reduceSpeed",
    "discord.createChannelInvite.never_expires",
    "discord.createMessage.nonce",
    "discord.createMessage.tts",
    "discord.getCurrentUserGuilds.after",
    "discord.getCurrentUserGuilds.before",
    "discord.startThreadWithoutMessage.type",
    "github-cli.attestationCreate.type",
    "github-cli.authLogin.token",
    "github-cli.repoCreate.private",
    "github-cli.starRepo.unstar",
    "markdown.updateDocument.context",
    "markdown.updateDocument.cursorPosition",
    "montage.addPhotos.search_filters",
    "montage.removePhotos.files",
    "montage.removePhotos.indices",
    "player.findMusic.play",
    "system.help.describeAgent.all",
] as const;

const OMIT_FROM_GOLD_PARAMETER_SET = new Set<string>(OMIT_FROM_GOLD_PARAMETERS);

export function isOmittedFromGoldParameter(
    schemaName: string,
    actionName: string,
    fieldName: string,
): boolean {
    return OMIT_FROM_GOLD_PARAMETER_SET.has(
        `${schemaName}.${actionName}.${fieldName}`,
    );
}

/** Field names to omit from gold for one action (empty when none). */
export function omittedGoldParameterNames(
    schemaName: string,
    actionName: string,
): string[] {
    const prefix = `${schemaName}.${actionName}.`;
    return OMIT_FROM_GOLD_PARAMETERS.filter((full) =>
        full.startsWith(prefix),
    ).map((full) => full.slice(prefix.length));
}

/**
 * Drop OMIT_FROM_GOLD_PARAMETERS keys from gold parameters.
 * Returns a new object; omits `parameters` entirely when nothing remains.
 */
export function stripOmittedGoldParameters(
    schemaName: string,
    actionName: string,
    parameters: Record<string, unknown> | undefined,
): {
    parameters: Record<string, unknown> | undefined;
    removed: string[];
} {
    if (parameters === undefined) {
        return { parameters: undefined, removed: [] };
    }
    const removed: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parameters)) {
        if (isOmittedFromGoldParameter(schemaName, actionName, key)) {
            removed.push(key);
            continue;
        }
        next[key] = value;
    }
    if (removed.length === 0) {
        return { parameters, removed };
    }
    return {
        parameters: Object.keys(next).length > 0 ? next : undefined,
        removed,
    };
}
