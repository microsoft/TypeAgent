// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TranslationBenchBenchmarkSchema,
    TranslationBenchTargetAction,
} from "./benchmark.js";

export interface TranslationBenchActionRef {
    schemaName: string;
    actionName: string;
    description?: string;
}

export interface TranslationBenchConfusableSibling
    extends TranslationBenchActionRef {
    reason: string;
}

const KNOWN_CONFUSABLE_PAIRS: ReadonlyArray<
    readonly [TranslationBenchActionRef, TranslationBenchActionRef, string]
> = [
    [
        { schemaName: "browser", actionName: "followLinkByText" },
        { schemaName: "browser", actionName: "openWebPage" },
        "open X vs click link whose text is X",
    ],
    [
        { schemaName: "browser", actionName: "followLinkByPosition" },
        { schemaName: "browser", actionName: "openSearchResult" },
        "nth result / position open collisions",
    ],
    [
        { schemaName: "browser", actionName: "followLinkByText" },
        { schemaName: "browser", actionName: "openSearchResult" },
        "result/link open collisions",
    ],
    [
        { schemaName: "browser.external", actionName: "closeTab" },
        { schemaName: "browser", actionName: "closeWebPage" },
        "close tab vs close page",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "getAllWebFlows" },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "page capabilities / flows discovery",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "inferActions" },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "infer vs detect page actions",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "getAllWebFlows" },
        { schemaName: "browser.actionDiscovery", actionName: "inferActions" },
        "flows vs inferred actions",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "registerPageDynamicAgent",
        },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "register page agent vs detect page actions (registerAgent:true)",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "getWebFlowsForDomain",
        },
        {
            schemaName: "browser.actionDiscovery",
            actionName: "detectPageActions",
        },
        "domain web-flows lookup vs inspect/detect page actions",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "getWebFlowsForDomain",
        },
        { schemaName: "browser", actionName: "openWebPage" },
        "list flows for domain hostname vs navigate to that hostname",
    ],
    [
        { schemaName: "browser.external", actionName: "openTab" },
        { schemaName: "browser", actionName: "openWebPage" },
        "open a new tab at URL vs open web page",
    ],
    [
        { schemaName: "browser.external", actionName: "switchToTabByPosition" },
        { schemaName: "browser", actionName: "changeTab" },
        "switch to nth tab vs change active tab by index",
    ],
    [
        { schemaName: "browser.external", actionName: "switchToTabByText" },
        { schemaName: "browser", actionName: "changeTab" },
        "switch to tab by title text vs change active tab by description",
    ],
    [
        { schemaName: "browser.actionDiscovery", actionName: "getAllWebFlows" },
        { schemaName: "browser.webFlows", actionName: "listWebFlows" },
        "get all web flows vs list web flows",
    ],
    [
        {
            schemaName: "browser.actionDiscovery",
            actionName: "createInferredFlows",
        },
        { schemaName: "browser", actionName: "createInferredFlow" },
        "create inferred flows vs create inferred flow",
    ],
    [
        { schemaName: "code", actionName: "newMarkdownFile" },
        { schemaName: "markdown", actionName: "createDocument" },
        "new markdown file in editor vs create markdown document",
    ],
    [
        { schemaName: "code", actionName: "newTextFile" },
        { schemaName: "utility", actionName: "writeFile" },
        "new text file in editor vs write file to disk",
    ],
    [
        { schemaName: "code.code-debug", actionName: "startDebugging" },
        { schemaName: "visualStudio", actionName: "debug" },
        "start debugging in VS Code vs Visual Studio debug",
    ],
    [
        { schemaName: "code.code-display", actionName: "openSettings" },
        { schemaName: "code.code-general", actionName: "showUserSettings" },
        "open settings vs show user settings",
    ],
    [
        { schemaName: "visualStudio", actionName: "stepInto" },
        { schemaName: "code.code-debug", actionName: "step" },
        "Visual Studio step into vs code debug step",
    ],
    [
        { schemaName: "visualStudio", actionName: "stepOut" },
        { schemaName: "code.code-debug", actionName: "step" },
        "Visual Studio step out vs code debug step",
    ],
    [
        { schemaName: "visualStudio", actionName: "addBreakpoint" },
        { schemaName: "code.code-debug", actionName: "setBreakpoint" },
        "Visual Studio add breakpoint vs code set breakpoint",
    ],
    [
        { schemaName: "visualStudio", actionName: "gotoLine" },
        { schemaName: "code.code-editor", actionName: "moveCursorInFile" },
        "go to line vs move cursor in file",
    ],
    [
        { schemaName: "visualStudio", actionName: "openFile" },
        { schemaName: "code.code-workbench", actionName: "workbenchOpenFile" },
        "Visual Studio open file vs workbench open file",
    ],
    [
        { schemaName: "desktop", actionName: "SetScreenResolution" },
        {
            schemaName: "desktop.desktop-display",
            actionName: "DisplayResolutionAndAspectRatio",
        },
        "set screen resolution vs display resolution setting",
    ],
    [
        { schemaName: "desktop", actionName: "SetThemeMode" },
        {
            schemaName: "desktop.desktop-personalization",
            actionName: "SystemThemeMode",
        },
        "set theme mode vs system theme mode",
    ],
    [
        { schemaName: "desktop", actionName: "SetTextSize" },
        { schemaName: "desktop.desktop-display", actionName: "DisplayScaling" },
        "set text size vs display scaling",
    ],
    [
        { schemaName: "desktop", actionName: "AdjustScreenBrightness" },
        { schemaName: "settings", actionName: "dimBrightNessAction" },
        "adjust screen brightness vs dim brightness setting",
    ],
    [
        { schemaName: "localPlayer", actionName: "playFromQueue" },
        { schemaName: "player", actionName: "getQueue" },
        "play from queue vs get queue",
    ],
    [
        { schemaName: "localPlayer", actionName: "showQueue" },
        { schemaName: "player", actionName: "getQueue" },
        "show queue vs get queue",
    ],
    [
        { schemaName: "github-cli", actionName: "browseIssue" },
        { schemaName: "browser", actionName: "openWebPage" },
        "browse issue vs open web page",
    ],
    [
        { schemaName: "github-cli", actionName: "workflowView" },
        { schemaName: "code.code-workbench", actionName: "workbenchOpenFile" },
        "workflow view vs workbench open file",
    ],
    [
        {
            schemaName: "onboarding.onboarding-packaging",
            actionName: "generateDemo",
        },
        { schemaName: "video", actionName: "createVideoAction" },
        "generate demo vs create video",
    ],
];

function keyOf(ref: TranslationBenchActionRef): string {
    return `${ref.schemaName}.${ref.actionName}`;
}

function sameAction(
    a: TranslationBenchActionRef,
    b: TranslationBenchActionRef,
): boolean {
    return a.schemaName === b.schemaName && a.actionName === b.actionName;
}

function splitCamel(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

const STOP_TOKENS = new Set([
    "a",
    "an",
    "the",
    "by",
    "to",
    "of",
    "for",
    "and",
    "or",
    "with",
    "from",
    "in",
    "on",
    "at",
    "action",
    "actions",
]);

function significantTokens(name: string): Set<string> {
    const out = new Set<string>();
    for (const token of splitCamel(name)) {
        if (token.length < 3 || STOP_TOKENS.has(token)) continue;
        out.add(token);
    }
    return out;
}

function significantTokensFromText(text: string | undefined): Set<string> {
    if (text === undefined) return new Set();
    const out = new Set<string>();
    for (const token of splitCamel(text)) {
        if (token.length < 3 || STOP_TOKENS.has(token)) continue;
        out.add(token);
    }
    return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    return inter / (a.size + b.size - inter);
}

function listCatalogActions(
    catalog: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchActionRef[] {
    const out: TranslationBenchActionRef[] = [];
    for (const schema of catalog) {
        for (const tool of schema.tools) {
            if (tool.type !== "function") continue;
            out.push({
                schemaName: schema.schemaName,
                actionName: tool.function.name,
                ...(tool.function.description !== undefined
                    ? { description: tool.function.description }
                    : {}),
            });
        }
    }
    return out;
}

export function findTranslationBenchConfusableSiblings(
    target: TranslationBenchTargetAction,
    catalog: readonly TranslationBenchBenchmarkSchema[],
): TranslationBenchConfusableSibling[] {
    const all = listCatalogActions(catalog);
    const byKey = new Map(all.map((a) => [keyOf(a), a]));
    const found = new Map<string, TranslationBenchConfusableSibling>();

    const add = (sibling: TranslationBenchActionRef, reason: string) => {
        if (sameAction(sibling, target)) return;
        if (!byKey.has(keyOf(sibling))) return;
        if (found.has(keyOf(sibling))) return;
        const live = byKey.get(keyOf(sibling))!;
        found.set(keyOf(sibling), {
            schemaName: live.schemaName,
            actionName: live.actionName,
            ...(live.description !== undefined
                ? { description: live.description }
                : {}),
            reason,
        });
    };

    for (const [left, right, reason] of KNOWN_CONFUSABLE_PAIRS) {
        if (sameAction(left, target)) add(right, reason);
        if (sameAction(right, target)) add(left, reason);
    }

    const targetTokens = significantTokens(target.actionName);
    for (const action of all) {
        if (action.schemaName !== target.schemaName) continue;
        if (sameAction(action, target)) continue;
        const overlap = jaccard(
            targetTokens,
            significantTokens(action.actionName),
        );
        if (overlap >= 0.34) {
            add(
                action,
                `same-schema action-name overlap (${overlap.toFixed(2)})`,
            );
        }
    }

    const targetDescTokens = significantTokensFromText(
        byKey.get(keyOf(target))?.description,
    );
    for (const action of all) {
        if (action.schemaName === target.schemaName) continue;
        if (sameAction(action, target)) continue;
        const nameOverlap = jaccard(
            targetTokens,
            significantTokens(action.actionName),
        );
        if (nameOverlap < 0.5) continue;
        const descOverlap = jaccard(
            targetDescTokens,
            significantTokensFromText(action.description),
        );
        if (descOverlap < 0.34) continue;
        add(
            action,
            `cross-schema overlap (name ${nameOverlap.toFixed(
                2,
            )}, desc ${descOverlap.toFixed(2)})`,
        );
    }

    return [...found.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

export function summarizeTranslationBenchConfusableSiblings(
    _target: TranslationBenchTargetAction,
    siblings: readonly TranslationBenchConfusableSibling[],
): Array<{
    action: string;
    reason: string;
}> {
    return siblings.map((sibling) => ({
        action: keyOf(sibling),
        reason: sibling.reason,
    }));
}
