// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createDecisionModel,
    getRuntimeConfigGeneration,
    type DecisionModel,
    type DecisionRequest,
    type DecisionResponse,
    type DecisionResult,
} from "@typeagent/aiclient";
import {
    CROSSWORD_DECISION_LIMITS as limits,
    isCrosswordDecisionStrategy,
    type CrosswordClueBody,
    type CrosswordDecisionCapabilities,
    type CrosswordDecisionStatus,
    type CrosswordRpcOrigin,
    type CrosswordSnapshot,
    type ResolveCrosswordClueRequest,
    type ResolveCrosswordClueResponse,
} from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { createHash } from "node:crypto";
import registerDebug from "debug";
import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

const debug = registerDebug("typeagent:browser:crosswordDecision");

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
    !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, max = 256): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= max;
const onlyKeys = (value: RecordValue, keys: string[]) =>
    Object.keys(value).every((key) => keys.includes(key));
const probability = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1;

function validOrigin(value: unknown): value is CrosswordRpcOrigin {
    return (
        record(value) &&
        onlyKeys(value, ["tabId", "frameId", "documentId"]) &&
        integer(value.tabId) &&
        integer(value.frameId) &&
        text(value.documentId)
    );
}

const originKey = (origin: CrosswordRpcOrigin) =>
    JSON.stringify([origin.tabId, origin.frameId, origin.documentId]);

function validRequest(
    value: unknown,
    now: number,
): value is ResolveCrosswordClueRequest {
    if (
        !record(value) ||
        !onlyKeys(value, [
            "snapshot",
            "clueNumber",
            "clueDirection",
            "origin",
            "strategy",
            "includeBody",
            "bodyCandidateId",
        ]) ||
        (value.includeBody !== undefined &&
            typeof value.includeBody !== "boolean") ||
        (value.bodyCandidateId !== undefined &&
            (value.includeBody !== true || !text(value.bodyCandidateId, 64))) ||
        (value.strategy !== undefined &&
            !isCrosswordDecisionStrategy(value.strategy)) ||
        !validOrigin(value.origin) ||
        !integer(value.clueNumber) ||
        value.clueNumber < 1 ||
        value.clueNumber > 9999 ||
        (value.clueDirection !== "across" && value.clueDirection !== "down") ||
        !validSnapshot(value.snapshot, now)
    )
        return false;
    return (
        (value.bodyCandidateId === undefined ||
            value.snapshot.candidates.some(
                (candidate) => candidate.id === value.bodyCandidateId,
            )) &&
        Buffer.byteLength(JSON.stringify(value), "utf8") <= limits.snapshotBytes
    );
}

function validSnapshot(
    value: unknown,
    now: number,
): value is CrosswordSnapshot {
    if (!record(value)) return false;
    const s = value;
    if (
        !onlyKeys(s, [
            "snapshotId",
            "documentToken",
            "puzzleId",
            "revision",
            "modeGeneration",
            "createdAt",
            "collectorVersion",
            "complete",
            "candidates",
        ]) ||
        !text(s.snapshotId) ||
        !text(s.documentToken) ||
        !text(s.puzzleId) ||
        !integer(s.revision) ||
        !integer(s.modeGeneration) ||
        !integer(s.createdAt) ||
        s.createdAt > now + 5000 ||
        s.collectorVersion !== limits.collectorVersion ||
        s.complete !== true ||
        !Array.isArray(s.candidates) ||
        s.candidates.length === 0 ||
        s.candidates.length > limits.candidates
    )
        return false;
    const ids = new Set<string>();
    for (const candidate of s.candidates) {
        if (!validCandidate(candidate) || ids.has(candidate.id)) return false;
        ids.add(candidate.id);
    }
    return true;
}

function validCandidate(
    candidate: unknown,
): candidate is CrosswordSnapshot["candidates"][number] {
    if (!record(candidate)) return false;
    const source = candidate.text;
    return (
        onlyKeys(candidate, [
            "id",
            "text",
            "context",
            "role",
            "regionId",
            "scopeId",
            "bodyTexts",
        ]) &&
        text(candidate.id, 64) &&
        candidate.id !== "no_fit" &&
        candidate.id !== "ambiguous" &&
        text(source, limits.textLength) &&
        typeof candidate.context === "string" &&
        candidate.context.length <= limits.contextLength &&
        (candidate.role === undefined || text(candidate.role, 64)) &&
        (candidate.regionId === undefined || text(candidate.regionId, 64)) &&
        (candidate.scopeId === undefined || text(candidate.scopeId, 64)) &&
        (candidate.bodyTexts === undefined ||
            (Array.isArray(candidate.bodyTexts) &&
                candidate.bodyTexts.length <= limits.candidates &&
                candidate.bodyTexts.every(
                    (part) =>
                        text(part, limits.textLength) && source.includes(part),
                )))
    );
}

function response(
    params: unknown,
    status: CrosswordDecisionStatus,
    configGeneration = "",
): ResolveCrosswordClueResponse {
    const s = record(params) && record(params.snapshot) ? params.snapshot : {};
    return {
        snapshotId: text(s.snapshotId) ? s.snapshotId : "",
        documentToken: text(s.documentToken) ? s.documentToken : "",
        puzzleId: text(s.puzzleId) ? s.puzzleId : "",
        revision: integer(s.revision) ? s.revision : 0,
        modeGeneration: integer(s.modeGeneration) ? s.modeGeneration : 0,
        configGeneration,
        status,
    };
}

export function buildCrosswordDecisionRequest(
    params: ResolveCrosswordClueRequest,
): DecisionRequest {
    const request = targetDecisionRequest(params);
    if (!fitsDecision(request, params.snapshot.candidates.length))
        throw new RangeError(
            "Requested-target evidence exceeds native decision limits.",
        );
    return request;
}

function targetDecisionRequest(
    params: ResolveCrosswordClueRequest,
): DecisionRequest {
    const criteria: Record<string, string> = Object.create(null);
    for (const c of params.snapshot.candidates) {
        criteria[c.id] = JSON.stringify({
            text: c.text,
            context: c.context,
            role: c.role,
            regionId: c.regionId,
            scopeId: c.scopeId,
        });
    }
    criteria.no_fit = "No match in this batch.";
    criteria.ambiguous =
        "Conflicting matches, multiple matching puzzles, or unclear identity.";
    return {
        state: {
            scopeContext:
                "Scope IDs are opaque DOM/frame boundaries, not catalog identifiers. Decide clue identity and semantic ambiguity from the supplied evidence.",
            clueNumber: params.clueNumber,
            clueDirection: params.clueDirection,
        },
        questions: {
            target: {
                type: "choice",
                instructions: `Select the entry for clue ${params.clueNumber} ${params.clueDirection} using its text and context. IDs are labels, not clue numbers. Duplicate views of one clue in one puzzle are equivalent. Choose ambiguous for conflicting matching clues, multiple matching puzzles, or unclear identity. Choose no_fit if this batch has no match. Select the clue, not its answer.`,
                criteria,
            },
        },
    };
}

type SnapshotState = {
    snapshotId: string;
    revision: number;
    modeGeneration: number;
    fingerprint: string;
    expires: number;
    regions?: { generation: string; selection: RegionSelection };
};
type RegionSelection = { candidateIds: string[]; excluded: boolean };
type RegionResolution = { selection?: RegionSelection };
type Running = { origin: string; controller: AbortController };

function snapshotFingerprint(s: CrosswordSnapshot): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                s.snapshotId,
                s.documentToken,
                s.puzzleId,
                s.revision,
                s.modeGeneration,
                s.createdAt,
                s.collectorVersion,
                s.complete,
                s.candidates.map((c) => [
                    c.id,
                    c.text,
                    c.context,
                    c.role ?? null,
                    c.regionId ?? null,
                    c.scopeId ?? null,
                    c.bodyTexts ?? null,
                ]),
            ]),
        )
        .digest("hex");
}

class DecisionStopped extends Error {
    constructor(
        readonly status: CrosswordDecisionStatus,
        message?: string,
    ) {
        super(message);
    }
}

class DecisionRepacking extends Error {}

type Choice = { choice: string; probability: number };
type Decide = (request: DecisionRequest) => Promise<Record<string, Choice>>;
type Candidate = CrosswordSnapshot["candidates"][number];

export function countCrosswordDecisionTokens(request: DecisionRequest): number {
    return countTokens(JSON.stringify(request), {
        disallowedSpecial: new Set(),
    });
}

const fitsDecision = (
    request: DecisionRequest,
    count: number,
    tokenLimit: number = limits.decisionTokens,
) =>
    count <= limits.decisionCandidates &&
    Object.keys(request.questions).length <= limits.decisionQuestions &&
    countCrosswordDecisionTokens(request) <= tokenLimit;

function readChoices(
    request: DecisionRequest,
    result: DecisionResult<DecisionResponse>,
): Record<string, Choice> {
    if (!result.success) {
        throw new DecisionStopped(
            result.code === "cancelled"
                ? "cancelled"
                : ["configuration", "unavailable", "timeout"].includes(
                        result.code,
                    )
                  ? "unavailable"
                  : "provider_error",
        );
    }
    const answers = result.data?.answers;
    const keys = Object.keys(request.questions);
    if (!record(answers) || !onlyKeys(answers, keys))
        throw new DecisionStopped("provider_error");
    const choices: Record<string, Choice> = Object.create(null);
    for (const key of keys) {
        const answer = answers[key];
        const question = request.questions[key];
        if (
            question.type !== "choice" ||
            !record(answer) ||
            !onlyKeys(answer, [
                "type",
                "choice",
                "probabilities",
                "confidence",
            ]) ||
            answer.type !== "choice" ||
            !text(answer.choice, 64) ||
            !Object.prototype.hasOwnProperty.call(
                question.criteria,
                answer.choice,
            ) ||
            !record(answer.probabilities) ||
            Object.keys(answer.probabilities).length !==
                Object.keys(question.criteria).length ||
            !probability(answer.probabilities[answer.choice]) ||
            (answer.confidence !== undefined &&
                !probability(answer.confidence)) ||
            Object.entries(answer.probabilities).some(
                ([id, p]) =>
                    !Object.prototype.hasOwnProperty.call(
                        question.criteria,
                        id,
                    ) || !probability(p),
            ) ||
            Math.abs(
                Object.values(answer.probabilities).reduce<number>(
                    (sum, p) => sum + (p as number),
                    0,
                ) - 1,
            ) > 1e-6
        )
            throw new DecisionStopped("provider_error");
        choices[key] = {
            choice: answer.choice,
            probability: answer.probabilities[answer.choice],
        };
    }
    return choices;
}

function boundedBatches<T>(
    entries: T[],
    build: (entries: T[]) => DecisionRequest,
    tokenLimit: number,
): T[][] {
    const batches: T[][] = [];
    for (let start = 0; start < entries.length; ) {
        const maximum = Math.min(
            entries.length - start,
            limits.decisionCandidates,
        );
        let size = maximum;
        if (
            !fitsDecision(
                build(entries.slice(start, start + size)),
                size,
                tokenLimit,
            )
        ) {
            let low = 1;
            let high = maximum - 1;
            size = 0;
            while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                if (
                    fitsDecision(
                        build(entries.slice(start, start + middle)),
                        middle,
                        tokenLimit,
                    )
                ) {
                    size = middle;
                    low = middle + 1;
                } else high = middle - 1;
            }
        }
        if (!size)
            throw new DecisionStopped(
                "unsupported",
                "Evidence exceeds a native decision budget.",
            );
        batches.push(entries.slice(start, start + size));
        start += size;
    }
    return batches;
}

type Region = { id: string; candidates: Candidate[]; preview?: Candidate[] };

function regionEvidence(region: Region) {
    const candidates = region.preview ?? region.candidates;
    return {
        id: region.id,
        entryCount: region.candidates.length,
        evidence:
            candidates.length === region.candidates.length
                ? "complete"
                : "partial",
        previewCount: candidates.length,
        candidates,
    };
}

export function buildCrosswordDiscoveryRequest(
    regions: Region[],
): DecisionRequest {
    const questions: DecisionRequest["questions"] = Object.create(null);
    for (const region of regions) {
        const evidence = JSON.stringify(regionEvidence(region));
        questions[region.id] = {
            type: "choice",
            instructions: `Does this region contain crossword clues? ${evidence}\nFor a partial preview, choose uncertain unless clues are visible.`,
            criteria: {
                clues: "Crossword clues or clue numbering/direction context.",
                other: "Unrelated to crossword clues.",
                uncertain: "Insufficient evidence.",
            },
        };
    }
    return {
        state: {},
        questions,
    };
}

function boundedRegion(region: Region, tokenLimit: number): Region {
    let preview = region.candidates;
    while (
        !fitsDecision(
            buildCrosswordDiscoveryRequest([{ ...region, preview }]),
            1,
            tokenLimit,
        )
    ) {
        if (preview.length <= 1)
            throw new DecisionStopped(
                "unsupported",
                "Region preview exceeds native decision limits.",
            );
        preview = preview.slice(0, Math.ceil(preview.length / 2));
    }
    return { ...region, preview };
}

async function discoverCandidates(
    candidates: Candidate[],
    decide: Decide,
    tokenLimit: number,
) {
    const grouped = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
        const key = candidate.regionId ?? "";
        const group = grouped.get(key) ?? [];
        group.push(candidate);
        grouped.set(key, group);
    }
    const regions = Array.from(grouped.values(), (entries, i) =>
        boundedRegion({ id: `region_${i}`, candidates: entries }, tokenLimit),
    );
    const retained: Candidate[] = [];
    let excluded = false;
    for (const group of boundedBatches(
        regions,
        buildCrosswordDiscoveryRequest,
        tokenLimit,
    )) {
        const classifications = await decide(
            buildCrosswordDiscoveryRequest(group),
        );
        for (const region of group) {
            if (
                classifications[region.id].choice === "other" &&
                region.preview?.length === region.candidates.length
            )
                excluded = true;
            else retained.push(...region.candidates);
        }
    }
    return { retained, excluded };
}

async function resolveEvidence(
    params: ResolveCrosswordClueRequest,
    generation: string,
    decide: Decide,
    regions: RegionResolution,
    tokenLimit: number,
): Promise<ResolveCrosswordClueResponse> {
    const targetRequest = (candidates: Candidate[]) =>
        targetDecisionRequest({
            ...params,
            snapshot: { ...params.snapshot, candidates },
        });
    let batches: Candidate[][];
    let excluded = false;
    if (
        params.strategy !== "hybrid2" &&
        fitsDecision(
            targetRequest(params.snapshot.candidates),
            params.snapshot.candidates.length,
            tokenLimit,
        )
    ) {
        batches = [params.snapshot.candidates];
    } else {
        let selection = regions.selection;
        if (!selection) {
            const discovery = await discoverCandidates(
                params.snapshot.candidates,
                decide,
                tokenLimit,
            );
            selection = {
                candidateIds: discovery.retained.map(
                    (candidate) => candidate.id,
                ),
                excluded: discovery.excluded,
            };
            regions.selection = selection;
        }
        excluded = selection.excluded;
        const retained = new Set(selection.candidateIds);
        batches = boundedBatches(
            params.snapshot.candidates.filter((candidate) =>
                retained.has(candidate.id),
            ),
            targetRequest,
            tokenLimit,
        );
    }
    const selected: { candidate: Candidate; probability: number }[] = [];
    let ambiguous = false;
    for (const batch of batches) {
        const target = (await decide(targetRequest(batch))).target;
        if (target.choice === "ambiguous") {
            ambiguous = true;
        } else if (target.choice !== "no_fit") {
            selected.push({
                candidate: batch.find((c) => c.id === target.choice)!,
                probability: target.probability,
            });
        }
    }
    let first = selected[0];
    if (!first) {
        if (ambiguous) return response(params, "ambiguous", generation);
        return {
            ...response(
                params,
                excluded ? "unsupported" : "no_fit",
                generation,
            ),
            ...(excluded
                ? {
                      message:
                          "No target found in retained evidence; excluded regions prevent claiming absence.",
                  }
                : {}),
        };
    }
    if (selected.length > 1) {
        const comparison = targetRequest(
            selected.map(({ candidate }) => candidate),
        );
        if (!fitsDecision(comparison, selected.length, tokenLimit))
            throw new DecisionStopped(
                "unsupported",
                "Cross-batch comparison exceeds a native decision budget.",
            );
        const target = (await decide(comparison)).target;
        if (target.choice === "ambiguous")
            return response(params, "ambiguous", generation);
        if (target.choice === "no_fit")
            return response(
                params,
                excluded ? "unsupported" : "no_fit",
                generation,
            );
        first = {
            candidate: selected.find(
                ({ candidate }) => candidate.id === target.choice,
            )!.candidate,
            probability: target.probability,
        };
    }
    return {
        ...response(params, "resolved", generation),
        candidateId: first.candidate.id,
        choiceProbability: first.probability,
    };
}

type BodyOption = CrosswordClueBody & { id: string };

export function crosswordBodyOptions(candidate: Candidate): BodyOption[] {
    const options = new Map<string, CrosswordClueBody>();
    for (const part of candidate.bodyTexts ?? []) {
        const start = candidate.text.indexOf(part);
        if (start >= 0 && part)
            options.set(part, { start, end: start + part.length, text: part });
    }
    let start = 0;
    for (const character of candidate.text) {
        if (character.trim()) {
            const part = candidate.text.slice(start);
            options.set(part, {
                start,
                end: candidate.text.length,
                text: part,
            });
        }
        start += character.length;
    }
    return Array.from(options.values(), (body, index) => ({
        ...body,
        id: `body_${index}`,
    }));
}

export function buildCrosswordBodyRequest(
    candidate: Candidate,
    options = crosswordBodyOptions(candidate),
): DecisionRequest {
    const request: DecisionRequest = {
        state: {},
        questions: {
            body: {
                type: "choice",
                instructions: `Select the complete clue text from this entry: ${JSON.stringify({ text: candidate.text, context: candidate.context })}. Omit the clue number, direction, and separate UI labels. Keep clue punctuation, leading digits, and printed enumerations such as (5).`,
                criteria: {
                    ...Object.fromEntries(
                        options.map((option) => [
                            option.id,
                            JSON.stringify(option.text),
                        ]),
                    ),
                    no_fit: "No complete body in this batch.",
                    ambiguous: "Body boundary is unclear.",
                },
            },
        },
    };
    return request;
}

async function resolveBody(
    candidate: Candidate,
    decide: Decide,
    tokenLimit: number,
): Promise<CrosswordClueBody> {
    const build = (options: BodyOption[]) =>
        buildCrosswordBodyRequest(candidate, options);
    const winners: BodyOption[] = [];
    let ambiguous = false;
    for (const batch of boundedBatches(
        crosswordBodyOptions(candidate),
        build,
        tokenLimit,
    )) {
        const choice = (await decide(build(batch))).body.choice;
        if (choice === "ambiguous") ambiguous = true;
        else if (choice !== "no_fit")
            winners.push(batch.find((option) => option.id === choice)!);
    }
    let winner = winners[0];
    if (winners.length > 1) {
        const choice = (await decide(build(winners))).body.choice;
        winner = winners.find((option) => option.id === choice)!;
        ambiguous = choice === "ambiguous";
    }
    if (!winner)
        throw new DecisionStopped(
            ambiguous ? "ambiguous" : "unsupported",
            "No exact clue body was selected from the issued strings.",
        );
    return { start: winner.start, end: winner.end, text: winner.text };
}

export class CrosswordDecisionHandler {
    private model: DecisionModel | undefined;
    private readonly snapshots = new Map<string, SnapshotState>();
    private readonly running = new Map<string, Running>();

    constructor(
        private readonly dependencies = {
            createModel: createDecisionModel,
            generation: getRuntimeConfigGeneration,
            now: Date.now,
            timeoutMs: limits.timeoutMs as number,
            telemetry: (event: {
                status: string;
                candidates: number;
                durationMs: number;
            }) => {
                debug(
                    "status=%s candidates=%d durationMs=%d",
                    event.status,
                    event.candidates,
                    event.durationMs,
                );
            },
        },
    ) {}

    private getModel() {
        if (this.model?.configGeneration === this.dependencies.generation()) {
            return { success: true as const, data: this.model };
        }
        this.model = undefined;
        const result = this.dependencies.createModel();
        if (result.success) this.model = result.data;
        return result;
    }

    capabilities(): CrosswordDecisionCapabilities {
        try {
            const model = this.getModel();
            return model.success
                ? {
                      available: true,
                      provider: model.data.provider,
                      model: model.data.model,
                      configGeneration: String(model.data.configGeneration),
                  }
                : {
                      available: false,
                      configGeneration: String(this.dependencies.generation()),
                      message: "Decision provider is not configured.",
                  };
        } catch {
            return {
                available: false,
                configGeneration: "",
                message: "Decision provider is unavailable.",
            };
        }
    }

    cancel(clientId: string, params: unknown): void {
        if (
            !record(params) ||
            !text(params.requestId) ||
            !validOrigin(params.origin)
        )
            return;
        const running = this.running.get(
            JSON.stringify([clientId, params.requestId]),
        );
        if (running?.origin === originKey(params.origin))
            running.controller.abort();
    }

    disconnect(clientId: string): void {
        for (const [key, request] of this.running) {
            if ((JSON.parse(key) as string[])[0] === clientId)
                request.controller.abort();
        }
        for (const key of this.snapshots.keys()) {
            if ((JSON.parse(key) as unknown[])[0] === clientId)
                this.snapshots.delete(key);
        }
    }

    private registerSnapshot(
        clientId: string,
        params: ResolveCrosswordClueRequest,
        started: number,
    ) {
        const s = params.snapshot;
        const key = JSON.stringify([
            clientId,
            params.origin!.tabId,
            params.origin!.frameId,
            params.origin!.documentId,
            s.documentToken,
            s.puzzleId,
        ]);
        const fingerprint = snapshotFingerprint(s);
        for (const [id, state] of this.snapshots) {
            const [client, tab, frame, document] = JSON.parse(id) as unknown[];
            const supersededDocument =
                client === clientId &&
                tab === params.origin!.tabId &&
                frame === params.origin!.frameId &&
                document !== params.origin!.documentId;
            if (state.expires <= started || supersededDocument)
                this.snapshots.delete(id);
        }
        const prior = this.snapshots.get(key);
        if (
            prior &&
            (s.modeGeneration < prior.modeGeneration ||
                (s.modeGeneration === prior.modeGeneration &&
                    (s.revision < prior.revision ||
                        (s.revision === prior.revision &&
                            (s.snapshotId !== prior.snapshotId ||
                                fingerprint !== prior.fingerprint)))))
        ) {
            return { key, fingerprint, status: "stale" as const };
        }
        if (this.snapshots.size >= 512 && !prior)
            return { key, fingerprint, status: "unavailable" as const };
        this.snapshots.set(key, {
            snapshotId: s.snapshotId,
            revision: s.revision,
            modeGeneration: s.modeGeneration,
            fingerprint,
            expires: s.createdAt + limits.snapshotLifetimeMs,
            ...(prior?.fingerprint === fingerprint && prior.regions
                ? { regions: prior.regions }
                : {}),
        });
        return { key, fingerprint, status: undefined };
    }

    private cachedRegions(
        key: string,
        params: ResolveCrosswordClueRequest,
        generation: string,
    ): RegionResolution {
        const cached = this.snapshots.get(key)?.regions;
        return params.strategy === "hybrid2" &&
            cached?.generation === generation
            ? { selection: cached.selection }
            : {};
    }

    private rememberRegions(
        key: string,
        generation: string,
        result: ResolveCrosswordClueResponse,
        regions: RegionResolution,
    ): void {
        if (result.status === "resolved" && regions.selection)
            this.snapshots.get(key)!.regions = {
                generation,
                selection: regions.selection,
            };
    }

    async resolve(
        clientId: string,
        requestId: string,
        params: unknown,
    ): Promise<ResolveCrosswordClueResponse> {
        const started = this.dependencies.now();
        if (
            !text(clientId) ||
            !text(requestId) ||
            !validRequest(params, started)
        ) {
            return response(params, "unsupported");
        }
        const s = params.snapshot;
        if (started - s.createdAt >= limits.snapshotLifetimeMs)
            return response(params, "stale");
        const registered = this.registerSnapshot(clientId, params, started);
        if (registered.status) return response(params, registered.status);
        const { key, fingerprint } = registered;
        const runningKey = JSON.stringify([clientId, requestId]);
        if (this.running.size >= 128 || this.running.has(runningKey))
            return response(params, "unavailable");
        const controller = new AbortController();
        this.running.set(runningKey, {
            origin: originKey(params.origin!),
            controller,
        });
        let result = response(params, "provider_error");
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const finish = (
            status: CrosswordDecisionStatus,
            generation = result.configGeneration,
        ) => {
            result = response(params, status, generation);
            return result;
        };
        try {
            const model = this.getModel();
            if (!model.success) return finish("unavailable");
            const generation = String(model.data.configGeneration);
            const regions = this.cachedRegions(key, params, generation);
            result.configGeneration = generation;
            const duration = Math.min(
                this.dependencies.timeoutMs,
                s.createdAt + limits.snapshotLifetimeMs - started,
            );
            const deadline = started + duration;
            let timedOut = false;
            let calls = 0;
            let tokenLimit: number = limits.decisionTokens;
            const guard = () => {
                if (controller.signal.aborted)
                    throw new DecisionStopped(
                        timedOut ? "unavailable" : "cancelled",
                        timedOut
                            ? "Crossword decision deadline exceeded."
                            : undefined,
                    );
                if (
                    this.dependencies.generation() !==
                        model.data.configGeneration ||
                    this.dependencies.now() >=
                        s.createdAt + limits.snapshotLifetimeMs ||
                    this.snapshots.get(key)?.fingerprint !== fingerprint
                )
                    throw new DecisionStopped("stale");
                if (this.dependencies.now() >= deadline)
                    throw new DecisionStopped(
                        "unavailable",
                        "Crossword decision deadline exceeded.",
                    );
            };
            const aborted = new Promise<never>((_, reject) => {
                onAbort = () =>
                    reject(
                        new DecisionStopped(
                            timedOut ? "unavailable" : "cancelled",
                            timedOut
                                ? "Crossword decision deadline exceeded."
                                : undefined,
                        ),
                    );
                controller.signal.addEventListener("abort", onAbort, {
                    once: true,
                });
            });
            timer = setTimeout(
                () => {
                    timedOut = true;
                    controller.abort();
                },
                Math.max(0, deadline - this.dependencies.now()),
            );
            const decide: Decide = async (request) => {
                guard();
                if (calls >= limits.maxDecisionCalls)
                    throw new DecisionStopped(
                        "unsupported",
                        "Crossword discovery exceeds the maximum decision call budget.",
                    );
                if (
                    !fitsDecision(
                        request,
                        Object.keys(request.questions).length,
                        tokenLimit,
                    )
                )
                    throw new DecisionStopped(
                        "unsupported",
                        "Evidence exceeds a native decision budget.",
                    );
                calls++;
                const decision = await Promise.race([
                    model.data.decide(request, {
                        signal: controller.signal,
                        timeoutMs: Math.max(
                            1,
                            deadline - this.dependencies.now(),
                        ),
                    }),
                    aborted,
                ]);
                guard();
                if (
                    !decision.success &&
                    model.data.provider === "azure" &&
                    decision.httpStatus === 422
                ) {
                    if (
                        tokenLimit > limits.decisionRepackTokens &&
                        countCrosswordDecisionTokens(request) >
                            limits.decisionRepackTokens
                    )
                        throw new DecisionRepacking();
                    throw new DecisionStopped(
                        "provider_error",
                        "Azure rejected the decision request with HTTP 422 at or below the 16K-token repacking budget.",
                    );
                }
                return readChoices(request, decision);
            };
            let selected: ResolveCrosswordClueResponse | undefined;
            const resolveAttempt = async () => {
                selected ??= params.bodyCandidateId
                    ? {
                          ...response(params, "resolved", generation),
                          candidateId: params.bodyCandidateId,
                      }
                    : await resolveEvidence(
                          params,
                          generation,
                          decide,
                          regions,
                          tokenLimit,
                      );
                if (selected.status === "resolved" && params.includeBody) {
                    const candidate = s.candidates.find(
                        (entry) => entry.id === selected!.candidateId,
                    )!;
                    return {
                        ...selected,
                        body: await resolveBody(candidate, decide, tokenLimit),
                    };
                }
                return selected;
            };
            try {
                result = await resolveAttempt();
            } catch (error) {
                if (!(error instanceof DecisionRepacking)) throw error;
                tokenLimit = limits.decisionRepackTokens;
                debug(
                    "Azure HTTP 422: repacking crossword evidence at %d tokens.",
                    tokenLimit,
                );
                result = await resolveAttempt();
            }
            guard();
            if (params.strategy === "hybrid2")
                this.rememberRegions(key, generation, result, regions);
            return result;
        } catch (error) {
            if (error instanceof DecisionStopped) {
                finish(error.status);
                if (error.message) result.message = error.message;
                return result;
            }
            return finish(
                controller.signal.aborted ? "cancelled" : "provider_error",
            );
        } finally {
            clearTimeout(timer);
            if (onAbort)
                controller.signal.removeEventListener("abort", onAbort);
            this.running.delete(runningKey);
            this.dependencies.telemetry({
                status: result.status,
                candidates: s.candidates.length,
                durationMs: this.dependencies.now() - started,
            });
        }
    }
}

export const crosswordDecisionHandler = new CrosswordDecisionHandler();
