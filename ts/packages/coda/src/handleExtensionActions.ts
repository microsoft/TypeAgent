// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionResult } from "./helpers";
import * as vscode from "vscode";

interface ExtensionMetadata {
    id: string;
    name: string;
    description: string;
    keywords: string[];
}

export async function handleCheckExtensionAvailable(
    action: any,
): Promise<ActionResult> {
    const { filterByUserQuery, filterByKnownQuery, filterByCategory } =
        action.parameters ?? {};

    if (!filterByUserQuery && !filterByKnownQuery && !filterByCategory) {
        return {
            handled: false,
            message:
                "❌ At least one of 'filterByUserQuery', 'filterByKnownQuery', or 'filterByCategory' must be provided.",
        };
    }

    // Construct search query string
    const searchQuery = [
        filterByKnownQuery ?? "",
        filterByCategory ? `@category:"${filterByCategory}"` : "",
        filterByUserQuery ?? "",
    ]
        .filter(Boolean)
        .join(" ")
        .trim();

    // Open Extension view with search applied
    await vscode.commands.executeCommand(
        "workbench.extensions.search",
        searchQuery,
    );

    return {
        handled: true,
        message: `🔍 Opened Extension view with query: \`${searchQuery}\``,
    };
}

export async function fetchTopExtensions(): Promise<ExtensionMetadata[]> {
    const body = {
        filters: [
            {
                criteria: [
                    { filterType: 8, value: "Microsoft.VisualStudio.Code" },
                ],
                pageNumber: 1,
                pageSize: 100,
                sortBy: 4, // install count
                sortOrder: 0,
            },
        ],
        flags: 914,
    };

    try {
        const res = await fetch(
            "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json;api-version=3.0-preview.1",
                },
                body: JSON.stringify(body),
            },
        );

        if (!res.ok) {
            throw new Error(
                `Marketplace fetch failed: ${res.status} ${res.statusText}`,
            );
        }

        const json = (await res.json()) as {
            results?: { extensions?: any[] }[];
        };
        const extensions = json.results?.[0]?.extensions ?? [];

        return extensions.map((ext: any) => ({
            id: `${ext.publisher.publisherName}.${ext.extensionName}`,
            name: ext.displayName,
            description: ext.shortDescription,
            keywords: ext.tags ?? [],
        }));
    } catch (err) {
        console.error("❌ Failed to fetch top extensions:", err);
        return [];
    }
}

export async function fetchExtensionsByQuery(
    query: string,
): Promise<ExtensionMetadata[]> {
    const body = {
        filters: [
            {
                criteria: [
                    { filterType: 8, value: "Microsoft.VisualStudio.Code" },
                    { filterType: 10, value: query },
                ],
                pageNumber: 1,
                pageSize: 25,
                sortBy: 4, // install count
                sortOrder: 0,
            },
        ],
        flags: 914,
    };

    try {
        const res = await fetch(
            "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json;api-version=3.0-preview.1",
                },
                body: JSON.stringify(body),
            },
        );

        if (!res.ok) {
            throw new Error(
                `Marketplace search failed: ${res.status} ${res.statusText}`,
            );
        }

        const json = (await res.json()) as {
            results?: { extensions?: any[] }[];
        };

        const extensions = json.results?.[0]?.extensions ?? [];

        return extensions.map((ext: any) => ({
            id: `${ext.publisher.publisherName}.${ext.extensionName}`,
            name: ext.displayName,
            description: ext.shortDescription,
            keywords: ext.tags ?? [],
        }));
    } catch (err) {
        console.error("❌ Marketplace search failed:", err);
        return [];
    }
}

export function findBestMatch(
    list: ExtensionMetadata[],
    query: string,
): ExtensionMetadata | undefined {
    const terms = query.toLowerCase().split(/\s+/); // e.g. ["azure", "functions"]

    return list.find((ext) => {
        const searchableText = [
            ext.id,
            ext.name,
            ext.description,
            ...(ext.keywords ?? []),
        ]
            .join(" ")
            .toLowerCase();

        // All terms must appear somewhere in the combined text
        return terms.every((term) => searchableText.includes(term));
    });
}

export function findInstalledExtensionByQuery(
    query: string,
): vscode.Extension<any> | undefined {
    const terms = query.toLowerCase().split(/\s+/);
    return vscode.extensions.all.find((ext) => {
        const text = [
            ext.id,
            ext.packageJSON.displayName,
            ext.packageJSON.description,
            ...(ext.packageJSON.keywords ?? []),
        ]
            .join(" ")
            .toLowerCase();

        return terms.every((term) => text.includes(term));
    });
}

export async function handleInstallExtension(
    action: any,
): Promise<ActionResult> {
    const {
        extensionQuery,
        promptUser = true,
        autoReload = false,
    } = action.parameters ?? {};
    if (!extensionQuery?.trim()) {
        return {
            handled: false,
            message: "❌ Missing 'extensionQuery'.",
        };
    }

    const query = extensionQuery.toLowerCase();

    const alreadyInstalled = vscode.extensions.all.find(
        (ext) =>
            ext.id.toLowerCase().includes(query) ||
            ext.packageJSON.displayName?.toLowerCase().includes(query),
    );

    if (alreadyInstalled) {
        return {
            handled: true,
            message: `✅ "${alreadyInstalled.packageJSON.displayName}" is already installed.`,
        };
    }

    const searchResults = await fetchExtensionsByQuery(query);
    const bestMatch = findBestMatch(searchResults, query);

    await vscode.commands.executeCommand("workbench.extensions.search", query);
    if (bestMatch === undefined) {
        return {
            handled: true,
            message: `❌ No matching extension found for "${extensionQuery}".`,
        };
    } else {
        const confirmed =
            !promptUser ||
            (await vscode.window.showInformationMessage(
                `Do you want to install "${bestMatch.name}"?`,
                { modal: true },
                "Yes",
            )) === "Yes";

        if (!confirmed) {
            return {
                handled: true,
                message: "🚫 User cancelled installation.",
            };
        }

        try {
            await vscode.commands.executeCommand(
                "workbench.extensions.installExtension",
                bestMatch.id,
            );
            if (autoReload) {
                await vscode.commands.executeCommand(
                    "workbench.action.reloadWindow",
                );
            }

            return {
                handled: true,
                message: `✅ Installed "${bestMatch.name}" (${bestMatch.id}).${autoReload ? " Reloading..." : ""}`,
            };
        } catch (err: any) {
            return {
                handled: false,
                message: `❌ Failed to install "${bestMatch.name}": ${err.message || err}`,
            };
        }
    }
}

export async function handleEnableExtension(
    action: any,
): Promise<ActionResult> {
    const {
        extensionQuery,
        promptUser = true,
        autoReload = false,
    } = action.parameters ?? {};
    if (!extensionQuery?.trim()) {
        return { handled: false, message: "❌ Missing 'extensionQuery'." };
    }

    const ext = findInstalledExtensionByQuery(extensionQuery);
    if (!ext) {
        return {
            handled: true,
            message: `❌ Could not find matching installed extension for "${extensionQuery}".`,
        };
    }

    if (ext.isActive) {
        return {
            handled: true,
            message: `✅ Extension '${ext.id}' is already enabled.`,
        };
    }

    const confirm =
        !promptUser ||
        (await vscode.window.showInformationMessage(
            `Enable extension '${ext.packageJSON.displayName ?? ext.id}'?`,
            { modal: true },
            "Yes",
        )) === "Yes";

    if (!confirm) {
        return { handled: true, message: "🚫 User cancelled enable request." };
    }

    await vscode.commands.executeCommand(
        "workbench.extensions.enableExtension",
        ext.id,
    );
    if (autoReload) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }

    return {
        handled: true,
        message: `✅ Extension '${ext.id}' enabled.${autoReload ? " Reloading..." : ""}`,
    };
}

export async function handleDisableExtension(
    action: any,
): Promise<ActionResult> {
    const {
        extensionQuery,
        promptUser = true,
        autoReload = false,
    } = action.parameters ?? {};
    if (!extensionQuery?.trim()) {
        return { handled: false, message: "❌ Missing 'extensionQuery'." };
    }

    const ext = findInstalledExtensionByQuery(extensionQuery);
    if (!ext) {
        return {
            handled: true,
            message: `❌ Could not find matching installed extension for "${extensionQuery}".`,
        };
    }

    const confirm =
        !promptUser ||
        (await vscode.window.showInformationMessage(
            `Disable extension '${ext.packageJSON.displayName ?? ext.id}'?`,
            { modal: true },
            "Yes",
        )) === "Yes";

    if (!confirm) {
        return { handled: true, message: "🚫 User cancelled disable request." };
    }

    await vscode.commands.executeCommand(
        "workbench.extensions.disableExtension",
        ext.id,
    );
    if (autoReload) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }

    return {
        handled: true,
        message: `✅ Extension '${ext.id}' disabled.${autoReload ? " Reloading..." : ""}`,
    };
}

export async function handleExtensionActions(
    action: any,
): Promise<ActionResult> {
    let actionResult: ActionResult = {
        handled: true,
        message: "Ok",
    };

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);

    switch (actionName) {
        case "checkExtensionAvailable": {
            actionResult = await handleCheckExtensionAvailable(action);
            break;
        }
        case "installExtension": {
            actionResult = await handleInstallExtension(action);
            break;
        }
        case "reloadWindow": {
            await vscode.commands.executeCommand(
                "workbench.action.reloadWindow",
            );
            actionResult.message = "Reloading VSCode window...";
            break;
        }
        case "showExtensions": {
            vscode.commands.executeCommand("workbench.view.extensions");
            actionResult.message = "Showing extensions";
            break;
        }
        case "enableExtension": {
            actionResult = await handleEnableExtension(action);
            break;
        }
        case "disableExtension": {
            actionResult = await handleDisableExtension(action);
            break;
        }
        default: {
            actionResult.message = `Did not understand the request for action: "${actionName}"`;
            actionResult.handled = false;
        }
    }
    return actionResult;
}
