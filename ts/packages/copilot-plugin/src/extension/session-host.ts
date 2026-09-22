// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    joinSession,
    type JoinSessionConfig,
} from "@github/copilot-sdk/extension";
import type { CopilotSession } from "@github/copilot-sdk";
import { getSelectedSkills } from "../shared/plugin-config.js";
import {
    materializeApprovedSkills,
    selectedSkillSessionConfig,
    type ApprovedSkillMaterialization,
    type SkillMaterializationDependencies,
    type SkillSelection,
} from "./skill-session.js";

export interface ExtensionSessionLifecycle {
    readonly session: CopilotSession;
    close(): Promise<void>;
    closeSync(): void;
}

export interface ExtensionSessionDependencies {
    join: (config: JoinSessionConfig) => Promise<CopilotSession>;
    getSelections: () => readonly SkillSelection[];
    materialization?: SkillMaterializationDependencies;
}

const defaultDependencies: ExtensionSessionDependencies = {
    join: joinSession,
    getSelections: getSelectedSkills,
};

/**
 * Joins the live extension session, materializing configured catalog skills
 * first so no unapproved or ambient skill source reaches the SDK.
 */
export async function joinTypeAgentSession(
    config: JoinSessionConfig,
    dependencies: ExtensionSessionDependencies = defaultDependencies,
): Promise<ExtensionSessionLifecycle> {
    let materialization: ApprovedSkillMaterialization | undefined;
    let session: CopilotSession | undefined;
    try {
        const selections = dependencies.getSelections();
        if (selections.length > 0) {
            materialization = await materializeApprovedSkills(
                selections,
                dependencies.materialization,
            );
        }
        const joinedSession = await dependencies.join({
            ...config,
            ...(materialization === undefined
                ? {}
                : selectedSkillSessionConfig(materialization.skillDirectories)),
        });
        session = joinedSession;
        let closePromise: Promise<void> | undefined;
        const closeMaterialization = (): Promise<void> => {
            closePromise ??= materialization?.close() ?? Promise.resolve();
            return closePromise;
        };
        joinedSession.on("session.shutdown", () => {
            void closeMaterialization().catch(() => {});
        });
        let lifecycleClosePromise: Promise<void> | undefined;
        const close = (): Promise<void> => {
            lifecycleClosePromise ??= (async () => {
                let disconnectError: unknown;
                try {
                    await joinedSession.disconnect();
                } catch (error) {
                    disconnectError = error;
                }
                await closeMaterialization();
                if (disconnectError !== undefined) throw disconnectError;
            })();
            return lifecycleClosePromise;
        };
        return {
            session: joinedSession,
            close,
            closeSync() {
                materialization?.closeSync();
            },
        };
    } catch (error) {
        if (session !== undefined) {
            await session.disconnect().catch(() => {});
        }
        await materialization?.close();
        throw error;
    }
}
