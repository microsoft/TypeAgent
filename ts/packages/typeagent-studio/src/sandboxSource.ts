// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SandboxStatus } from "@typeagent/core/sandbox";
import type { AvailableAgent } from "@typeagent/core/runtime";
import type { StudioServiceConnection } from "./studioServiceConnection.js";

/**
 * The sandbox-lifecycle surface the Sandbox tree + its commands need. The
 * in-process `StudioRuntime` conforms structurally, but unlike the Event Log /
 * Collisions sources there is NO in-process fallback for sandboxes: the agent
 * runtime is the single source of truth (a fallback would let a user start
 * sandboxes locally that the connected views never see — split-brain). When
 * disconnected, reads return empty and mutations reject with a clear message.
 */
export interface SandboxSource {
    listSandboxes(): Promise<SandboxStatus[]>;
    listAvailableAgents(): Promise<AvailableAgent[]>;
    startSandbox(options?: {
        id?: string;
        agents?: string[];
    }): Promise<SandboxStatus>;
    stopSandbox(id: string): Promise<void>;
    restartSandbox(id: string): Promise<void>;
    loadSandboxAgent(id: string, agentRef: string): Promise<SandboxStatus>;
    unloadSandboxAgent(id: string, agentName: string): Promise<SandboxStatus>;
    refreshSandboxAgent(agentName: string): Promise<number>;
    restoreSandboxes(): Promise<void>;
    onSandboxChanged(listener: () => void): { dispose(): void };
}

const NOT_CONNECTED =
    "Studio service is not connected — start the agent-server with the studio agent enabled, then try again.";

/**
 * Channel-backed {@link SandboxSource} over the shared connection. Sandbox
 * lifecycle pushes (`sandbox.*`) arrive on the connection's event fanout and
 * trigger {@link onSandboxChanged}.
 */
export class StudioServiceSandboxSource implements SandboxSource {
    constructor(private readonly connection: StudioServiceConnection) {}

    private require() {
        const client = this.connection.getClient();
        if (client === undefined) {
            throw new Error(NOT_CONNECTED);
        }
        return client;
    }

    async listSandboxes(): Promise<SandboxStatus[]> {
        return (await this.connection.getClient()?.listSandboxes()) ?? [];
    }

    async listAvailableAgents(): Promise<AvailableAgent[]> {
        return (await this.connection.getClient()?.listAvailableAgents()) ?? [];
    }

    async startSandbox(options?: {
        id?: string;
        agents?: string[];
    }): Promise<SandboxStatus> {
        return this.require().startSandbox(options);
    }

    async stopSandbox(id: string): Promise<void> {
        return this.require().stopSandbox(id);
    }

    async restartSandbox(id: string): Promise<void> {
        return this.require().restartSandbox(id);
    }

    async loadSandboxAgent(
        id: string,
        agentRef: string,
    ): Promise<SandboxStatus> {
        return this.require().loadSandboxAgent(id, agentRef);
    }

    async unloadSandboxAgent(
        id: string,
        agentName: string,
    ): Promise<SandboxStatus> {
        return this.require().unloadSandboxAgent(id, agentName);
    }

    async refreshSandboxAgent(agentName: string): Promise<number> {
        return this.require().refreshSandboxAgent(agentName);
    }

    async restoreSandboxes(): Promise<void> {
        return this.require().restoreSandboxes();
    }

    onSandboxChanged(listener: () => void): { dispose(): void } {
        return this.connection.onEvent((event) => {
            if (event.type.startsWith("sandbox.")) {
                listener();
            }
        });
    }
}
