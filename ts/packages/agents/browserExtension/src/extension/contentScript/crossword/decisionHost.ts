// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS as limits,
    isCrosswordMode,
    type CrosswordMode,
    type CrosswordDirection,
    type CrosswordDecisionCapabilities,
    type ResolveCrosswordClueResponse,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import {
    collect,
    textOf,
    validateNode,
    type Collected,
    type CandidateNode,
} from "./collector";
import { enterExolve } from "./exolveEntry";

export type RuntimeCall = (message: unknown) => Promise<unknown>;
export class CrosswordDecisionHost {
    private mode: CrosswordMode = "generative";
    private generation = 0;
    private revision = 0;
    private token = crypto.randomUUID();
    private state?: Collected;
    private config?: string;
    private bindings = new Map<string, CandidateNode>();
    private pending = new Map<string, Promise<CandidateNode>>();
    private observer: MutationObserver;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private runtime: RuntimeCall) {
        this.observer = new MutationObserver((records) =>
            this.checkMutations(records),
        );
        this.observer.observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                "id",
                "role",
                "aria-label",
                "aria-hidden",
                "hidden",
                "style",
                "class",
            ],
        });
    }

    changeMode(mode: CrosswordMode): void {
        if (mode === this.mode) return;
        this.mode = mode;
        this.invalidate();
    }

    invalidate(): void {
        const snapshotId = this.state?.snapshot.snapshotId;
        this.generation++;
        this.revision++;
        this.state = undefined;
        this.bindings.clear();
        this.pending.clear();
        if (snapshotId)
            void this.runtime({
                type: "cancelCrosswordDecisionRpc",
                snapshotId,
            }).catch(() => {});
    }

    dispose(): void {
        this.invalidate();
        this.observer.disconnect();
    }

    async getMode(): Promise<{ mode: CrosswordMode }> {
        const generation = this.generation;
        const response = (await this.runtime({ type: "getCrosswordMode" })) as
            | { mode?: unknown }
            | undefined;
        if (!isCrosswordMode(response?.mode))
            throw new Error(
                "unavailable: invalid extension crossword settings",
            );
        if (generation !== this.generation && response.mode !== this.mode)
            throw new Error("cancelled: settings changed during mode lookup");
        this.changeMode(response.mode);
        return { mode: this.mode };
    }

    private async capabilities(): Promise<CrosswordDecisionCapabilities> {
        const result = (await this.runtime({
            type: "crosswordDecisionRpc",
            method: "getCrosswordDecisionCapabilities",
        })) as CrosswordDecisionCapabilities;
        if (
            !result ||
            typeof result.available !== "boolean" ||
            typeof result.configGeneration !== "string"
        )
            throw new Error(
                "unavailable: invalid decision capability response",
            );
        if (
            this.config !== undefined &&
            this.config !== result.configGeneration
        )
            this.invalidate();
        this.config = result.configGeneration;
        return result;
    }

    async status(): Promise<
        CrosswordDecisionCapabilities & { mode: CrosswordMode; policy: string }
    > {
        const { mode } = await this.getMode();
        return {
            ...(await this.capabilities()),
            mode,
            policy: "uncalibrated local pilot; bounded on-demand Choice + fit",
        };
    }

    private checkMutations(records: MutationRecord[] = []): void {
        if (records.length + this.observer.takeRecords().length === 0) return;
        if (!this.state) return;
        try {
            for (const binding of this.state.registry.values())
                validateNode(this.state, binding);
            const fresh = collect(this.token, this.revision, this.generation);
            const nodes = [...this.state.registry.values()].map(
                (entry) => entry.node,
            );
            if (
                fresh.root !== this.state.root ||
                fresh.registry.size !== nodes.length ||
                [...fresh.registry.values()].some(
                    (entry, i) => entry.node !== nodes[i],
                )
            )
                this.invalidate();
        } catch {
            this.invalidate();
        }
    }

    private guard(state: Collected, binding?: CandidateNode): void {
        this.checkMutations();
        if (
            this.mode !== "decision" ||
            this.state !== state ||
            state.url !== location.href ||
            state.snapshot.modeGeneration !== this.generation ||
            Date.now() - state.snapshot.createdAt > limits.snapshotLifetimeMs
        ) {
            if (this.state === state) this.invalidate();
            throw new Error("stale: crossword state expired or changed");
        }
        if (binding) validateNode(state, binding);
    }

    private async resolve(
        number: number,
        direction: CrosswordDirection,
    ): Promise<{ state: Collected; binding: CandidateNode }> {
        if (
            !Number.isSafeInteger(number) ||
            number <= 0 ||
            number > 9999 ||
            (direction !== "across" && direction !== "down")
        )
            throw new Error("unsupported: invalid clue request");
        if ((await this.getMode()).mode !== "decision")
            throw new Error("cancelled: decision mode is not selected");
        const capability = await this.capabilities();
        if (!capability.available)
            throw new Error("unavailable: decision provider not available");
        this.checkMutations();
        if (
            this.state &&
            Date.now() - this.state.snapshot.createdAt >
                limits.snapshotLifetimeMs
        )
            this.invalidate();
        const state = (this.state ??= collect(
            this.token,
            this.revision,
            this.generation,
        ));
        const key = `${number}:${direction}`;
        this.guard(state);
        let binding = this.bindings.get(key);
        if (!binding) {
            let request = this.pending.get(key);
            if (!request) {
                request = this.match(
                    state,
                    number,
                    direction,
                    capability.configGeneration,
                );
                this.pending.set(key, request);
            }
            try {
                binding = await request;
            } finally {
                if (this.pending.get(key) === request) this.pending.delete(key);
            }
        }
        this.guard(state, binding);
        return { state, binding };
    }

    private async match(
        state: Collected,
        clueNumber: number,
        clueDirection: CrosswordDirection,
        config: string,
    ): Promise<CandidateNode> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = (await Promise.race([
                this.runtime({
                    type: "crosswordDecisionRpc",
                    method: "resolveCrosswordClue",
                    params: {
                        snapshot: state.snapshot,
                        clueNumber,
                        clueDirection,
                    },
                }),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(new Error("unavailable: decision deadline")),
                        limits.timeoutMs,
                    );
                }),
            ])) as ResolveCrosswordClueResponse;
            this.guard(state);
            const current = await this.capabilities();
            if (!current.available || current.configGeneration !== config)
                throw new Error("stale: decision configuration changed");
            this.guard(state);
            if (
                !response ||
                response.snapshotId !== state.snapshot.snapshotId ||
                response.documentToken !== state.snapshot.documentToken ||
                response.puzzleId !== state.snapshot.puzzleId ||
                response.revision !== state.snapshot.revision ||
                response.modeGeneration !== state.snapshot.modeGeneration ||
                response.configGeneration !== config ||
                this.config !== config
            )
                throw new Error("stale: mismatched decision response");
            if (response.status !== "resolved")
                throw new Error(`${response.status}: clue was not resolved`);
            if (
                !Number.isFinite(response.fit) ||
                response.fit! < limits.fitThreshold ||
                response.fit! > 1
            )
                throw new Error("no_fit: pilot fit gate rejected response");
            const binding = response.candidateId
                ? state.registry.get(response.candidateId)
                : undefined;
            if (!binding) throw new Error("unsupported: unissued candidate");
            this.guard(state, binding);
            this.bindings.set(`${clueNumber}:${clueDirection}`, binding);
            return binding;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async readClue(
        number: number,
        direction: CrosswordDirection,
    ): Promise<{ text: string }> {
        const { state, binding } = await this.resolve(number, direction);
        this.guard(state, binding);
        return {
            text: textOf(
                binding.node.querySelector(".xlv-clue-text") ?? binding.node,
            ),
        };
    }

    enterText(
        value: string,
        number: number,
        direction: CrosswordDirection,
    ): Promise<unknown> {
        const run = async () => {
            if (typeof value !== "string" || value.length > limits.textLength)
                throw new Error("unsupported: invalid answer");
            const { state, binding } = await this.resolve(number, direction);
            this.guard(state, binding);
            return enterExolve(state, binding, value, number, direction, () =>
                this.guard(state, binding),
            );
        };
        const result = this.queue.then(run);
        this.queue = result.catch(() => {});
        return result;
    }
}
