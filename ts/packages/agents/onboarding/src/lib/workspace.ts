// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Manages per-integration workspace state persisted to disk.
// Each integration gets a folder at ~/.typeagent/onboarding/<name>/
// containing state.json and phase-specific artifact subdirectories.

import fs from "fs/promises";
import path from "path";
import os from "os";

export type PhaseStatus = "pending" | "in-progress" | "approved" | "skipped";

export type PhaseState = {
    status: PhaseStatus;
    startedAt?: string;
    completedAt?: string;
};

export type OnboardingPhase =
    | "discovery"
    | "phraseGen"
    | "schemaGen"
    | "grammarGen"
    | "scaffolder"
    | "testing"
    | "packaging";

export const PHASE_ORDER: OnboardingPhase[] = [
    "discovery",
    "phraseGen",
    "schemaGen",
    "grammarGen",
    "scaffolder",
    "testing",
    "packaging",
];

export type OnboardingConfig = {
    integrationName: string;
    description?: string;
    apiType?: "rest" | "graphql" | "websocket" | "ipc" | "sdk";
    docSources?: string[];
};

export type OnboardingState = {
    integrationName: string;
    createdAt: string;
    updatedAt: string;
    // "complete" when all phases are approved
    currentPhase: OnboardingPhase | "complete";
    config: OnboardingConfig;
    phases: Record<OnboardingPhase, PhaseState>;
};

const BASE_DIR = path.join(os.homedir(), ".typeagent", "onboarding");

export function getWorkspacePath(integrationName: string): string {
    return path.join(BASE_DIR, integrationName);
}

export function getPhasePath(
    integrationName: string,
    phase: OnboardingPhase,
): string {
    return path.join(getWorkspacePath(integrationName), phase);
}

export async function createWorkspace(
    config: OnboardingConfig,
): Promise<OnboardingState> {
    const workspacePath = getWorkspacePath(config.integrationName);
    await fs.mkdir(workspacePath, { recursive: true });

    const emptyPhase = (): PhaseState => ({ status: "pending" });

    const state: OnboardingState = {
        integrationName: config.integrationName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentPhase: "discovery",
        config,
        phases: {
            discovery: emptyPhase(),
            phraseGen: emptyPhase(),
            schemaGen: emptyPhase(),
            grammarGen: emptyPhase(),
            scaffolder: emptyPhase(),
            testing: emptyPhase(),
            packaging: emptyPhase(),
        },
    };

    // Create phase subdirectories up front
    for (const phase of PHASE_ORDER) {
        await fs.mkdir(path.join(workspacePath, phase), { recursive: true });
    }

    await saveState(state);
    return state;
}

export async function loadState(
    integrationName: string,
): Promise<OnboardingState | undefined> {
    const statePath = path.join(
        getWorkspacePath(integrationName),
        "state.json",
    );
    try {
        const content = await fs.readFile(statePath, "utf-8");
        return JSON.parse(content) as OnboardingState;
    } catch {
        return undefined;
    }
}

export async function saveState(state: OnboardingState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    const statePath = path.join(
        getWorkspacePath(state.integrationName),
        "state.json",
    );
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function updatePhase(
    integrationName: string,
    phase: OnboardingPhase,
    update: Partial<PhaseState>,
): Promise<OnboardingState> {
    const state = await loadState(integrationName);
    if (!state) {
        throw new Error(`Integration "${integrationName}" not found`);
    }
    state.phases[phase] = { ...state.phases[phase], ...update };

    // When approved, advance currentPhase to the next phase
    if (update.status === "approved") {
        state.phases[phase].completedAt = new Date().toISOString();
        const idx = PHASE_ORDER.indexOf(phase);
        if (idx >= 0 && idx < PHASE_ORDER.length - 1) {
            state.currentPhase = PHASE_ORDER[idx + 1];
        } else if (idx === PHASE_ORDER.length - 1) {
            state.currentPhase = "complete";
        }
    }

    if (update.status === "in-progress" && !state.phases[phase].startedAt) {
        state.phases[phase].startedAt = new Date().toISOString();
    }

    await saveState(state);
    return state;
}

export async function readArtifact(
    integrationName: string,
    phase: OnboardingPhase,
    filename: string,
): Promise<string | undefined> {
    const filePath = path.join(getPhasePath(integrationName, phase), filename);
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return undefined;
    }
}

export async function writeArtifact(
    integrationName: string,
    phase: OnboardingPhase,
    filename: string,
    content: string,
): Promise<string> {
    const dirPath = getPhasePath(integrationName, phase);
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, filename);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
}

export async function readArtifactJson<T>(
    integrationName: string,
    phase: OnboardingPhase,
    filename: string,
): Promise<T | undefined> {
    const content = await readArtifact(integrationName, phase, filename);
    if (!content) return undefined;
    return JSON.parse(content) as T;
}

export async function writeArtifactJson(
    integrationName: string,
    phase: OnboardingPhase,
    filename: string,
    data: unknown,
): Promise<string> {
    return writeArtifact(
        integrationName,
        phase,
        filename,
        JSON.stringify(data, null, 2),
    );
}

export async function listIntegrations(): Promise<string[]> {
    try {
        const entries = await fs.readdir(BASE_DIR, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
        return [];
    }
}
