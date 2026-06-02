// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import * as vscode from "vscode";
import {
    InMemoryOnboardingBridge,
    type OnboardingState,
    routeStudioConversation,
} from "@typeagent/core/onboardingBridge";
import { InProcessEventStream } from "@typeagent/core/events";
import { InMemorySandboxManager } from "@typeagent/core/sandbox";

const LAST_ONBOARDING_SESSION_KEY = "studio.lastOnboardingSessionId";
const DEFAULT_SANDBOX_ID = "studio-default";

export interface StudioRuntime {
    startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState>;
    installLastSessionToSandbox(sandboxId?: string): Promise<string>;
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
}

export function createStudioRuntime(
    context: vscode.ExtensionContext,
): StudioRuntime {
    const events = new InProcessEventStream();
    const sandbox = new InMemorySandboxManager({ emitter: events });
    const onboarding = new InMemoryOnboardingBridge();

    const profileDir = path.join(
        context.globalStorageUri.fsPath,
        "profiles",
        DEFAULT_SANDBOX_ID,
    );

    return {
        async startOnboarding(seed) {
            const state = await onboarding.start(seed);
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                state.sessionId,
            );
            return state;
        },
        async installLastSessionToSandbox(sandboxId = DEFAULT_SANDBOX_ID) {
            const sessionId = context.workspaceState.get<string>(
                LAST_ONBOARDING_SESSION_KEY,
            );
            if (!sessionId) {
                throw new Error(
                    "No onboarding session found. Start one first with 'TypeAgent Studio: Start onboarding session'.",
                );
            }

            try {
                await sandbox.status(sandboxId);
            } catch {
                await sandbox.start({
                    id: sandboxId,
                    mode: "inmemory",
                    profileDir,
                    agents: [],
                });
            }

            await onboarding.installToSandbox(sessionId, sandboxId);
            return sessionId;
        },
        routeConversation(prompt) {
            const routed = routeStudioConversation(prompt);
            return {
                target: routed.target,
                reason: routed.reason,
            };
        },
    };
}
