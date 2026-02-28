// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type AppAgent,
    type AppAction,
    type ActionContext,
    type ActionResult,
    type SessionContext,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { TaskFlowActions } from "./schema/userActions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Genre list ───────────────────────────────────────────────────────────────
// Permissive seed list — dynamic cache population fills in the rest over time.

const KNOWN_GENRES: string[] = [
    "acoustic",
    "adult contemporary",
    "afrobeat",
    "alternative",
    "americana",
    "ambient",
    "appalachian",
    "bachata",
    "bebop",
    "big band",
    "bluegrass",
    "blues",
    "bossa nova",
    "broadway",
    "cajun",
    "celtic",
    "children's",
    "chillout",
    "christian",
    "christmas",
    "classic rock",
    "classical",
    "contemporary christian",
    "country",
    "cumbia",
    "dance",
    "disco",
    "drum and bass",
    "dubstep",
    "edm",
    "electronic",
    "emo",
    "flamenco",
    "folk",
    "funk",
    "gospel",
    "grunge",
    "hard rock",
    "hip-hop",
    "hip hop",
    "holiday",
    "honky tonk",
    "house",
    "indie",
    "industrial",
    "j-pop",
    "jazz",
    "k-pop",
    "latin",
    "lo-fi",
    "metal",
    "mountain",
    "musical theatre",
    "new age",
    "new wave",
    "old-time",
    "opera",
    "outlaw country",
    "pop",
    "power pop",
    "progressive rock",
    "psychedelic",
    "punk",
    "r&b",
    "rap",
    "red dirt",
    "reggae",
    "rnb",
    "rockabilly",
    "salsa",
    "singer-songwriter",
    "ska",
    "smooth jazz",
    "soft rock",
    "soul",
    "swing",
    "swing jazz",
    "techno",
    "tejano",
    "trap",
    "western swing",
    "world music",
    "worship",
    "zydeco",
];

function isKnownGenre(genre: string): boolean {
    const normalized = genre.toLowerCase().trim();
    return KNOWN_GENRES.some(
        (g) =>
            g === normalized ||
            normalized.includes(g) ||
            g.includes(normalized),
    );
}

// ── Action handler ───────────────────────────────────────────────────────────
// Note: flow actions (e.g. createTopSongsPlaylist) are intercepted by the
// dispatcher's flow interpreter before reaching here. This handler only
// handles non-flow actions like listTaskFlows.

async function handleTaskFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    _context: ActionContext<any>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "listTaskFlows": {
            const manifestPath = join(__dirname, "..", "manifest.json");
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            const flows = Object.keys(manifest.flows ?? {});
            return createActionResultFromTextDisplay(
                `Recorded task flows:\n${flows.map((f) => `  • ${f}`).join("\n") || "  (none)"}`,
            );
        }
        default:
            return createActionResultFromError(
                `Unknown task flow '${action.actionName}'. Use 'list my task flows' to see available flows.`,
            );
    }
}

// ── Wildcard validation ──────────────────────────────────────────────────────

async function validateTaskFlowWildcardMatch(
    action: AppAction,
    _context: SessionContext,
): Promise<boolean> {
    const a = action as TaskFlowActions;
    if (a.actionName === "createTopSongsPlaylist") {
        return isKnownGenre(a.parameters.genre);
    }
    return true;
}

// ── Action completion ────────────────────────────────────────────────────────

async function getTaskFlowActionCompletion(
    _context: SessionContext,
    action: AppAction,
    propertyName: string,
): Promise<string[] | undefined> {
    if (
        action.actionName === "createTopSongsPlaylist" &&
        propertyName === "parameters.genre"
    ) {
        return [...KNOWN_GENRES].sort();
    }
    return undefined;
}

// ── Instantiate ──────────────────────────────────────────────────────────────

export function instantiate(): AppAgent {
    return {
        executeAction(action, context: ActionContext<any>) {
            return handleTaskFlowAction(
                action as {
                    actionName: string;
                    parameters?: Record<string, unknown>;
                },
                context,
            );
        },
        validateWildcardMatch: validateTaskFlowWildcardMatch,
        getActionCompletion: getTaskFlowActionCompletion,
    };
}
