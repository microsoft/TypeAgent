// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `@collision preferences` — inspect and edit the Tier-1 profile-scoped
// collision preference store ("given these competing options the user always
// picks X"). The store is consumed by the `preference-clarify` resolution
// strategy; see docs/architecture/collision/collision-rollout.md.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { PreferenceMember } from "../../collisionPreferences.js";

/**
 * Parse a `schema.action` token into a PreferenceMember. The schema name is
 * everything before the first dot; the action name is the remainder. Returns
 * undefined when the token is missing a dot.
 */
function parseMember(token: string): PreferenceMember | undefined {
    const trimmed = token.trim();
    const dot = trimmed.indexOf(".");
    if (dot <= 0 || dot >= trimmed.length - 1) {
        return undefined;
    }
    return {
        schemaName: trimmed.slice(0, dot),
        actionName: trimmed.slice(dot + 1),
    };
}

function memberLabel(m: PreferenceMember): string {
    return `${m.schemaName}.${m.actionName}`;
}

class CollisionPreferenceListCommandHandler implements CommandHandler {
    public readonly description = "List stored collision preferences (Tier-1)";
    public readonly parameters = {} as const;

    public async run(context: ActionContext<CommandHandlerContext>) {
        const store = context.sessionContext.agentContext.collisionPreferences;
        const prefs = store.list();
        if (prefs.length === 0) {
            displayResult("No collision preferences stored.", context);
            return;
        }
        const lines = prefs.map((p) => {
            const set = p.candidateSet.map(memberLabel).join(", ");
            return `- [${p.origin}] ${set} → ${memberLabel(p.chosen)}  (hits: ${p.hitCount})\n    key: ${p.key}`;
        });
        displayResult(
            `Stored collision preferences (${prefs.length}):\n${lines.join("\n")}`,
            context,
        );
    }
}

class CollisionPreferenceSetCommandHandler implements CommandHandler {
    public readonly description =
        "Set an explicit collision preference: among a candidate set, always pick the chosen option";
    public readonly parameters = {
        args: {
            candidates: {
                description:
                    'Comma-separated competing options as schema.action, e.g. "player.play,list.play".',
                type: "string",
            },
            chosen: {
                description:
                    "The option to always pick, as schema.action. Must be one of the candidates.",
                type: "string",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = context.sessionContext.agentContext.collisionPreferences;
        const members: PreferenceMember[] = [];
        for (const token of params.args.candidates.split(",")) {
            if (token.trim() === "") {
                continue;
            }
            const m = parseMember(token);
            if (m === undefined) {
                displayWarn(
                    `Invalid candidate "${token.trim()}". Expected schema.action.`,
                    context,
                );
                return;
            }
            members.push(m);
        }
        if (members.length < 2) {
            displayWarn(
                "A preference needs at least two competing options.",
                context,
            );
            return;
        }
        const chosen = parseMember(params.args.chosen);
        if (chosen === undefined) {
            displayWarn(
                `Invalid chosen "${params.args.chosen.trim()}". Expected schema.action.`,
                context,
            );
            return;
        }
        const inSet = members.some(
            (m) =>
                m.schemaName === chosen.schemaName &&
                m.actionName === chosen.actionName,
        );
        if (!inSet) {
            displayWarn(
                `Chosen "${memberLabel(chosen)}" is not among the candidates.`,
                context,
            );
            return;
        }
        const pref = store.set(members, chosen, "explicit");
        displayResult(
            `Preference set: ${pref.candidateSet
                .map(memberLabel)
                .join(
                    ", ",
                )} → ${memberLabel(pref.chosen)}\n    key: ${pref.key}`,
            context,
        );
    }
}

class CollisionPreferenceRemoveCommandHandler implements CommandHandler {
    public readonly description =
        "Remove a stored collision preference by key (see `@collision preferences list`)";
    public readonly parameters = {
        args: {
            key: {
                description: "The preference key to remove.",
                type: "string",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const store = context.sessionContext.agentContext.collisionPreferences;
        const key = params.args.key.trim();
        const removed = store.remove(key);
        if (removed) {
            displayResult(`Removed preference: ${key}`, context);
        } else {
            displayWarn(`No preference found with key: ${key}`, context);
        }
    }
}

class CollisionPreferenceClearCommandHandler implements CommandHandler {
    public readonly description = "Remove every stored collision preference";
    public readonly parameters = {} as const;

    public async run(context: ActionContext<CommandHandlerContext>) {
        const store = context.sessionContext.agentContext.collisionPreferences;
        const count = store.list().length;
        store.clear();
        displayResult(`Cleared ${count} collision preference(s).`, context);
    }
}

export function getCollisionPreferenceCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Inspect and edit Tier-1 collision preferences (used by the preference-clarify strategy)",
        defaultSubCommand: "list",
        commands: {
            list: new CollisionPreferenceListCommandHandler(),
            set: new CollisionPreferenceSetCommandHandler(),
            remove: new CollisionPreferenceRemoveCommandHandler(),
            clear: new CollisionPreferenceClearCommandHandler(),
        },
    };
}
