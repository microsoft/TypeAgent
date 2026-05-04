// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    appendFileSync,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    WriteStream,
} from "node:fs";
import path from "node:path";

import type {
    CapturedState,
    CapturedTransition,
} from "./exploreTypes.js";
import type { TreeNode } from "./types.js";

/**
 * On-disk layout for one exploration run:
 *   <runDir>/states.jsonl                  metadata index
 *   <runDir>/transitions.jsonl             edges
 *   <runDir>/states/state-NNN.json         full TreeNode per state
 *   <runDir>/screenshots/state-NNN.png     optional
 *   <runDir>/run.json                      run config + status
 *
 * Append-only JSONL allows in-place resume after a crash; the in-memory
 * fingerprint→stateId map is rebuilt from states.jsonl on load.
 */
export class ExploreGraph {
    private readonly statesByFp = new Map<string, string>();
    private readonly statesById = new Map<string, CapturedState>();
    private readonly transitions: CapturedTransition[] = [];
    private nextStateNum: number;
    private nextTransitionNum: number;

    private readonly statesStream: WriteStream;
    private readonly transitionsStream: WriteStream;

    constructor(public readonly runDir: string) {
        mkdirSync(path.join(runDir, "states"), { recursive: true });
        mkdirSync(path.join(runDir, "screenshots"), { recursive: true });

        // Restore prior state if files already exist.
        const statesFile = path.join(runDir, "states.jsonl");
        const transitionsFile = path.join(runDir, "transitions.jsonl");
        if (existsSync(statesFile)) {
            for (const line of readFileSync(statesFile, "utf8")
                .split("\n")
                .filter((l) => l.length > 0)) {
                const s = JSON.parse(line) as CapturedState;
                this.statesByFp.set(s.fingerprint, s.id);
                this.statesById.set(s.id, s);
            }
        }
        if (existsSync(transitionsFile)) {
            for (const line of readFileSync(transitionsFile, "utf8")
                .split("\n")
                .filter((l) => l.length > 0)) {
                this.transitions.push(JSON.parse(line) as CapturedTransition);
            }
        }
        this.nextStateNum = this.statesById.size + 1;
        this.nextTransitionNum = this.transitions.length + 1;
        this.statesStream = createWriteStream(statesFile, { flags: "a" });
        this.transitionsStream = createWriteStream(transitionsFile, { flags: "a" });
    }

    get stateCount(): number {
        return this.statesById.size;
    }

    get transitionCount(): number {
        return this.transitions.length;
    }

    get successfulTransitionCount(): number {
        let n = 0;
        for (const t of this.transitions) if (t.success) n++;
        return n;
    }

    get failedTransitionCount(): number {
        return this.transitions.length - this.successfulTransitionCount;
    }

    findStateByFingerprint(fingerprint: string): CapturedState | undefined {
        const id = this.statesByFp.get(fingerprint);
        return id ? this.statesById.get(id) : undefined;
    }

    listStateSummaries(): Array<{
        id: string;
        label?: string;
        fingerprint: string;
    }> {
        const out: Array<{ id: string; label?: string; fingerprint: string }> = [];
        for (const s of this.statesById.values()) {
            const item: { id: string; label?: string; fingerprint: string } = {
                id: s.id,
                fingerprint: s.fingerprint,
            };
            if (s.label !== undefined) item.label = s.label;
            out.push(item);
        }
        return out;
    }

    /**
     * Register a new state if its fingerprint is novel; otherwise return the
     * existing state record. The full tree JSON is persisted on disk.
     */
    upsertState(opts: {
        fingerprint: string;
        windowTitle: string;
        tree: TreeNode;
        screenshotPngBase64?: string;
        label?: string;
    }): { state: CapturedState; isNew: boolean } {
        const existingId = this.statesByFp.get(opts.fingerprint);
        if (existingId) {
            return { state: this.statesById.get(existingId)!, isNew: false };
        }
        const id = `state-${this.nextStateNum.toString().padStart(3, "0")}`;
        this.nextStateNum++;
        const treeFile = path.join("states", `${id}.json`);
        writeFileSync(
            path.join(this.runDir, treeFile),
            JSON.stringify(opts.tree, null, 2),
        );
        let screenshotFile: string | undefined;
        if (opts.screenshotPngBase64) {
            const sf = path.join("screenshots", `${id}.png`);
            writeFileSync(
                path.join(this.runDir, sf),
                Buffer.from(opts.screenshotPngBase64, "base64"),
            );
            screenshotFile = sf;
        }
        const state: CapturedState = {
            id,
            fingerprint: opts.fingerprint,
            capturedAt: Date.now(),
            windowTitle: opts.windowTitle,
            treeFile,
            ...(screenshotFile !== undefined ? { screenshotFile } : {}),
            ...(opts.label !== undefined ? { label: opts.label } : {}),
        };
        this.statesByFp.set(state.fingerprint, state.id);
        this.statesById.set(state.id, state);
        this.statesStream.write(JSON.stringify(state) + "\n");
        return { state, isNew: true };
    }

    addTransition(t: Omit<CapturedTransition, "id">): CapturedTransition {
        const id = `trans-${this.nextTransitionNum.toString().padStart(4, "0")}`;
        this.nextTransitionNum++;
        const full: CapturedTransition = { ...t, id };
        this.transitions.push(full);
        this.transitionsStream.write(JSON.stringify(full) + "\n");
        return full;
    }

    recentTransitions(n: number): CapturedTransition[] {
        return this.transitions.slice(Math.max(0, this.transitions.length - n));
    }

    async close(): Promise<void> {
        await Promise.all([
            new Promise<void>((res) => this.statesStream.end(() => res())),
            new Promise<void>((res) => this.transitionsStream.end(() => res())),
        ]);
    }

    /**
     * Append a JSON line to a sibling file (used for run.json snapshots).
     */
    writeRunMeta(name: string, content: object): void {
        appendFileSync(path.join(this.runDir, name), JSON.stringify(content) + "\n");
    }
}
