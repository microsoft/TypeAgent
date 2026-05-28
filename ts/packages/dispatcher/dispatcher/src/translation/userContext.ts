// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User-environment context for translation prompts.
//
// The translator today knows nothing about which app the user is currently
// in. That leaves collisions (e.g., "change volume" between desktop and
// spotify) entirely to the LLM's prior. This module defines a small,
// structured UserContext that callers can attach to a translation request;
// `createTypeAgentRequestPrompt` serializes it into a dedicated prompt
// section so the translator can use it as a signal.
//
// v1 fields are intentionally narrow — `activeApp` (the appAgentName the
// user is currently using) plus an optional description sourced from the
// agent manifest. Future fields (`recentApps`, `locale`, `deviceType`)
// can be added without changing the plumbing.

import type { AppAgentManager } from "../context/appAgentManager.js";
import { getAppAgentName } from "./agentTranslators.js";

export interface UserContext {
    /** Top-level appAgent name the user is currently working in (e.g., "spotify", "code"). */
    activeApp: string;
    /** Free-text description of the app, typically copied from the
     *  agent manifest. Optional so callers that only know the bare app
     *  name can still produce a useful context. */
    activeAppDescription?: string;
}

/**
 * Resolve a UserContext from a schema name by walking up to the
 * top-level app agent and reading its manifest description.
 *
 * Sub-schemas like `code.code-debug` resolve to the parent agent
 * (`code`) so the context names the app the user actually runs, not an
 * internal subdivision.
 *
 * Returns undefined when the schema can't be resolved — the caller
 * decides whether to fall back to a bare appAgentName or skip injection
 * entirely.
 */
export function resolveUserContextFromSchema(
    schemaName: string,
    agents: AppAgentManager,
): UserContext | undefined {
    const appAgentName = getAppAgentName(schemaName);
    if (!appAgentName) {
        return undefined;
    }
    let description: string | undefined;
    try {
        description = agents.getAppAgentDescription(appAgentName);
    } catch {
        // Unknown app agent — fall through and return a context with
        // just the name. The translator can still benefit from knowing
        // the app's identifier even without a description.
        description = undefined;
    }
    return description
        ? { activeApp: appAgentName, activeAppDescription: description }
        : { activeApp: appAgentName };
}
