// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CROSSWORD_DECISION_LIMITS as limits,
    isCrosswordMode,
    isCrosswordDecisionStrategy,
    type CrosswordDecisionStrategy,
    type CrosswordMode,
    type CrosswordDirection,
    type CrosswordDecisionCapabilities,
    type CrosswordSnapshot,
    type ResolveCrosswordClueResponse,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import {
    collect,
    candidateText,
    textOf,
    validateNode,
    type Collected,
    type CandidateNode,
} from "./collector";
import { enterExolve } from "./exolveEntry";
import { CrosswordSentinels } from "./sentinels";

export type RuntimeCall = (message: unknown) => Promise<unknown>;
export class CrosswordDecisionHost {
    private mode: CrosswordMode = "generative";
    private strategy: CrosswordDecisionStrategy = "hybrid";
    private generation = 0;
    private revision = 0;
    private token = crypto.randomUUID();
    private state?: Collected;
    private config?: string;
    private bindings = new Map<string, CandidateNode>();
    private pending = new Map<string, Promise<CandidateNode>>();
    private readonly sentinels: CrosswordSentinels;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private runtime: RuntimeCall) {
        this.sentinels = new CrosswordSentinels(() => this.invalidate());
    }

    changeMode(mode: CrosswordMode, strategy = this.strategy): void {
        if (mode === this.mode && strategy === this.strategy) return;
        this.mode = mode;
        this.strategy = strategy;
        this.invalidate();
    }

    invalidate(): void {
        const snapshotId = this.state?.snapshot.snapshotId;
        this.generation++;
        this.revision++;
        this.state = undefined;
        this.sentinels.clear();
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
        this.sentinels.dispose();
    }

    async getMode(): Promise<{ mode: CrosswordMode }> {
        const generation = this.generation;
        const response = (await this.runtime({ type: "getCrosswordMode" })) as
            | { mode?: unknown; strategy?: unknown }
            | undefined;
        if (!isCrosswordMode(response?.mode))
            throw new Error(
                "unavailable: invalid extension crossword settings",
            );
        if (
            response.strategy !== undefined &&
            !isCrosswordDecisionStrategy(response.strategy)
        )
            throw new Error("unavailable: invalid crossword Decision strategy");
        const strategy = response.strategy ?? "hybrid";
        if (
            generation !== this.generation &&
            (response.mode !== this.mode || strategy !== this.strategy)
        )
            throw new Error("cancelled: settings changed during mode lookup");
        this.changeMode(response.mode, strategy);
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
        CrosswordDecisionCapabilities & {
            mode: CrosswordMode;
            strategy: CrosswordDecisionStrategy;
            policy: string;
        }
    > {
        const { mode } = await this.getMode();
        return {
            ...(await this.capabilities()),
            mode,
            strategy: this.strategy,
            policy: "hybrid visible-text discovery; model-selected target Choice; no verification or uniqueness score",
        };
    }

    private guard(state: Collected, binding?: CandidateNode): void {
        this.sentinels.check();
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
        if (binding) {
            try {
                validateNode(state, binding);
            } catch (error) {
                this.invalidate();
                throw error;
            }
            this.sentinels.watch(binding.node, () => candidateText(binding));
        }
    }

    async capture(): Promise<CrosswordSnapshot> {
        if ((await this.getMode()).mode !== "decision")
            throw new Error("cancelled: decision mode is not selected");
        this.sentinels.check();
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
        this.guard(state);
        return state.snapshot;
    }

    executeCaptured(
        method: "readClue" | "enterText",
        params: {
            snapshotId: string;
            candidateId: string;
            configGeneration: string;
            clueNumber: number;
            clueDirection: CrosswordDirection;
            value?: string;
        },
    ): Promise<unknown> {
        const run = async () => {
            this.validateRequest(params.clueNumber, params.clueDirection);
            if ((await this.getMode()).mode !== "decision")
                throw new Error("cancelled: decision mode is not selected");
            const capability = await this.capabilities();
            if (
                !capability.available ||
                capability.configGeneration !== params.configGeneration
            )
                throw new Error("stale: decision configuration changed");
            const state = this.state;
            const binding = state?.registry.get(params.candidateId);
            if (
                !state ||
                state.snapshot.snapshotId !== params.snapshotId ||
                !binding
            )
                throw new Error("stale: captured crossword target changed");
            this.guard(state, binding);
            if (method === "readClue") return this.readBinding(binding);
            if (method !== "enterText")
                throw new Error(
                    "unsupported: unknown captured crossword action",
                );
            this.validateAnswer(params.value);
            return enterExolve(
                state,
                binding,
                params.value,
                params.clueNumber,
                params.clueDirection,
                () => this.guard(state, binding),
            );
        };
        if (method === "readClue") return run();
        const result = this.queue.then(run);
        this.queue = result.catch(() => {});
        return result;
    }

    private validateRequest(
        number: number,
        direction: CrosswordDirection,
    ): void {
        if (
            !Number.isSafeInteger(number) ||
            number <= 0 ||
            number > 9999 ||
            (direction !== "across" && direction !== "down")
        )
            throw new Error("unsupported: invalid clue request");
    }

    private validateAnswer(value: unknown): asserts value is string {
        if (typeof value !== "string" || value.length > limits.textLength)
            throw new Error("unsupported: invalid answer");
    }

    private readBinding(binding: CandidateNode): { text: string } {
        const clue = binding.node.querySelector(".xlv-clue-text");
        return { text: clue ? textOf(clue) : candidateText(binding) };
    }

    private async resolve(
        number: number,
        direction: CrosswordDirection,
    ): Promise<{ state: Collected; binding: CandidateNode }> {
        this.validateRequest(number, direction);
        const capability = await this.capabilities();
        if (!capability.available)
            throw new Error("unavailable: decision provider not available");
        await this.capture();
        const state = this.state!;
        if (!state.registry.size)
            throw new Error("no_fit: no visible text entries");
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
                        strategy: this.strategy,
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
                throw new Error(
                    `${response.status}: ${response.message ?? "clue was not resolved"}`,
                );
            if (
                response.choiceProbability !== undefined &&
                (!Number.isFinite(response.choiceProbability) ||
                    response.choiceProbability < 0 ||
                    response.choiceProbability > 1)
            )
                throw new Error("provider_error: invalid choice probability");
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
        return this.readBinding(binding);
    }

    enterText(
        value: string,
        number: number,
        direction: CrosswordDirection,
    ): Promise<unknown> {
        const run = async () => {
            this.validateAnswer(value);
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
