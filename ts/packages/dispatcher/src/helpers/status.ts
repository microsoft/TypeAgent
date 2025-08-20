// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherEmoji,
    DispatcherName,
} from "../context/dispatcher/dispatcherUtils.js";
import type { DispatcherStatus } from "../dispatcher.js";

export function getStatusSummary(
    state: DispatcherStatus,
    options?: {
        showPrimaryName?: boolean; // default true
    },
): string {
    const active: string[] = [];
    const showPrimaryName = options?.showPrimaryName ?? true;
    let primary: string = showPrimaryName
        ? `${DispatcherEmoji} ${DispatcherName} - `
        : `${DispatcherEmoji}:`;
    for (const agent of state.agents) {
        if (agent.request && agent.name !== DispatcherName) {
            return `{{${agent.emoji} ${agent.name.toUpperCase()}}}`;
        }
        if (agent.lastUsed) {
            active.unshift(agent.emoji);
        }
        if (agent.active) {
            active.push(agent.emoji);
        }
        if (agent.priority) {
            primary = showPrimaryName
                ? `${agent.emoji} ${agent.name} - `
                : `${agent.emoji}:`;
        }
    }
    return `${primary} [${Array.from(new Set(active)).join("")}]${state.details}`;
}
