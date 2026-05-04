// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWriteStream, mkdirSync, WriteStream } from "node:fs";
import path from "node:path";

import type {
    CapturedEvent,
    EventType,
    HelperClient,
} from "./helperClient.js";

const DEFAULT_EVENT_TYPES: EventType[] = [
    "Invoked",
    "ValueChanged",
    "ToggleStateChanged",
    "StructureChanged",
];

/**
 * Subscribes to UIA events on a target window and writes each captured event
 * as one JSONL line to `<workspaceDir>/recordings/<sessionId>/transitions.jsonl`.
 *
 * No source-attribution (agent vs. user) here — slice 5 just captures
 * everything. Tagging by initiator comes with the explore loop in slice 6.
 */
export class Recorder {
    private readonly writer: WriteStream;
    private readonly removeHandler: () => void;
    private subscriptionId: string | null = null;
    private eventCount = 0;
    private stopped = false;

    private constructor(
        private readonly client: HelperClient,
        public readonly sessionDir: string,
    ) {
        mkdirSync(sessionDir, { recursive: true });
        this.writer = createWriteStream(
            path.join(sessionDir, "transitions.jsonl"),
            { flags: "a" },
        );
        this.removeHandler = client.onEvent((evt) => this.handle(evt));
    }

    static async start(opts: {
        client: HelperClient;
        workspaceDir: string;
        sessionId?: string;
        root: string;
        eventTypes?: EventType[];
    }): Promise<Recorder> {
        const sessionId =
            opts.sessionId ?? new Date().toISOString().replace(/[:.]/g, "-");
        const sessionDir = path.join(
            opts.workspaceDir,
            "recordings",
            sessionId,
        );
        const recorder = new Recorder(opts.client, sessionDir);
        const sub = await opts.client.eventsSubscribe({
            root: opts.root,
            eventTypes: opts.eventTypes ?? DEFAULT_EVENT_TYPES,
        });
        recorder.subscriptionId = sub.subscriptionId;
        return recorder;
    }

    private handle(evt: CapturedEvent): void {
        if (this.stopped) {
            return;
        }
        if (
            this.subscriptionId &&
            evt.subscriptionId !== this.subscriptionId
        ) {
            return;
        }
        this.eventCount++;
        this.writer.write(JSON.stringify(evt) + "\n");
    }

    get count(): number {
        return this.eventCount;
    }

    async stop(): Promise<{ eventCount: number; sessionDir: string }> {
        if (this.stopped) {
            return { eventCount: this.eventCount, sessionDir: this.sessionDir };
        }
        this.stopped = true;
        if (this.subscriptionId) {
            try {
                await this.client.eventsUnsubscribe({
                    subscriptionId: this.subscriptionId,
                });
            } catch {
                /* helper may already be down */
            }
        }
        this.removeHandler();
        await new Promise<void>((res) => this.writer.end(() => res()));
        return { eventCount: this.eventCount, sessionDir: this.sessionDir };
    }
}
