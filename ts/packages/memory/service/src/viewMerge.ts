// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { diff3Merge, diffIndices } from "node-diff3";
import { canonicalizeProcedure } from "./agentEdition.js";
import type {
    TroubleshootingGuideContent,
    ViewEditOperation,
    ViewRelationshipInput,
    ViewSynthesisOutput,
    ViewVersion,
} from "./viewTypes.js";
import { authoredRelationships, edgeIdentity } from "./viewRelationships.js";
export { edgeIdentity } from "./viewRelationships.js";

export function viewHash(value: unknown): string {
    return createHash("sha256")
        .update(canonicalizeProcedure(value ?? null))
        .digest("hex");
}

export function mergeProse(
    base: string,
    human: string,
    generated: string,
): string | undefined {
    if (human === base) return generated;
    if (generated === base || human === generated) return human;
    const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const buffers = [human, base, generated].map(lines);
    if (
        [base, human, generated].some((value) => value.length > 120_000) ||
        buffers.some((buffer) => buffer.length > 4000)
    )
        throw new Error(
            "Prose merge exceeds the bounded 120000 character/4000 line limit",
        );
    if (
        ambiguousInsertion(buffers[1], buffers[0]) ||
        ambiguousInsertion(buffers[1], buffers[2])
    )
        return undefined;
    const regions = diff3Merge(buffers[0], buffers[1], buffers[2], {
        excludeFalseConflicts: true,
    });
    if (regions.some((region) => region.conflict)) return undefined;
    return regions.flatMap((region) => region.ok ?? []).join("");
}

function ambiguousInsertion(base: string[], changed: string[]): boolean {
    return diffIndices(base, changed).some((change) => {
        if (change.buffer1[1] !== 0) return false;
        const offset = change.buffer1[0];
        const before = base[offset - 1];
        const after = base[offset];
        let matches = 0;
        for (let index = 0; index <= base.length; index++)
            if (base[index - 1] === before && base[index] === after) matches++;
        return matches > 1;
    });
}

function fields(content: TroubleshootingGuideContent): Map<string, unknown> {
    const values = new Map<string, unknown>([
        ["title", content.title],
        ["summary", content.summary],
        ["citations", content.citations],
    ]);
    for (const section of content.sections) {
        values.set(`section:${section.id}`, section);
    }
    return values;
}

function values(
    content: TroubleshootingGuideContent,
    edges: ViewRelationshipInput[],
): Map<string, unknown> {
    const result = fields(content);
    for (const edge of edges) result.set(`edge:${edgeIdentity(edge)}`, edge);
    return result;
}

export function recordViewEdits(
    current: ViewVersion | undefined,
    content: TroubleshootingGuideContent,
    edges: ViewRelationshipInput[],
    actor: string,
): ViewEditOperation[] {
    const prior = current
        ? values(
              current.content as TroubleshootingGuideContent,
              authoredRelationships(current),
          )
        : new Map<string, unknown>();
    const next = values(content, edges);
    const base = current?.generation
        ? values(
              current.generation.content as TroubleshootingGuideContent,
              current.generation.relationships ?? [],
          )
        : new Map<string, unknown>();
    const edits = structuredClone(current?.edits ?? []);
    for (const target of new Set([...prior.keys(), ...next.keys()])) {
        if (viewHash(prior.get(target)) === viewHash(next.get(target)))
            continue;
        const previous = [...edits]
            .reverse()
            .find(
                (edit) => edit.target === target && edit.status !== "cleared",
            );
        if (previous) previous.status = "cleared";
        const oldValue = base.get(target);
        const newValue = next.get(target);
        edits.push({
            id: randomUUID(),
            target,
            actor,
            createdAt: new Date().toISOString(),
            ...(current?.generation
                ? {
                      generatedBaseId: current.generation.candidateId,
                      baseFingerprint: current.generation.fingerprint,
                  }
                : {}),
            oldHash: viewHash(oldValue),
            ...(oldValue === undefined ? {} : { oldValue }),
            ...(newValue === undefined ? {} : { newValue }),
            operation: newValue === undefined ? "delete" : "set",
            status: "active",
        });
    }
    return edits;
}

function mergeValue(
    base: unknown,
    human: unknown,
    generated: unknown,
): unknown {
    if (viewHash(human) === viewHash(base)) return generated;
    if (
        viewHash(generated) === viewHash(base) ||
        viewHash(human) === viewHash(generated)
    )
        return human;
    if (
        typeof base === "string" &&
        typeof human === "string" &&
        typeof generated === "string"
    )
        return mergeProse(base, human, generated);
    return undefined;
}

function mergeSection(
    base: TroubleshootingGuideContent["sections"][number],
    human: TroubleshootingGuideContent["sections"][number],
    generated: TroubleshootingGuideContent["sections"][number],
): TroubleshootingGuideContent["sections"][number] | undefined {
    const heading = mergeValue(base.heading, human.heading, generated.heading);
    const body = mergeValue(base.body, human.body, generated.body);
    const role = mergeValue(base.role, human.role, generated.role);
    if (
        typeof heading !== "string" ||
        typeof body !== "string" ||
        typeof role !== "string"
    )
        return undefined;
    return { id: base.id, heading, body, role: role as typeof base.role };
}

export function mergeView(
    current: ViewVersion | undefined,
    candidate: ViewSynthesisOutput,
): {
    output: ViewSynthesisOutput;
    conflicts: string[];
} {
    if (!current) return { output: structuredClone(candidate), conflicts: [] };
    if (!current.generation)
        return {
            output: structuredClone(candidate),
            conflicts: ["unknown-generated-base"],
        };
    const edits =
        current.edits?.filter((edit) => edit.status !== "cleared") ?? [];
    const output = structuredClone(candidate);
    const conflicts: string[] = [];
    const base = values(
        current.generation.content as TroubleshootingGuideContent,
        current.generation.relationships ?? [],
    );
    const human = values(
        current.content as TroubleshootingGuideContent,
        authoredRelationships(current),
    );
    const next = values(candidate.content, candidate.relationships);
    const tracked = new Set(edits.map((edit) => edit.target));
    for (const target of new Set([...base.keys(), ...human.keys()]))
        if (
            viewHash(base.get(target)) !== viewHash(human.get(target)) &&
            !tracked.has(target)
        )
            conflicts.push(`untracked:${target}`);
    for (const edit of edits) {
        if (
            edit.generatedBaseId !== current.generation.candidateId ||
            edit.baseFingerprint !== current.generation.fingerprint ||
            edit.oldHash !== viewHash(base.get(edit.target)) ||
            viewHash(edit.newValue) !== viewHash(human.get(edit.target))
        ) {
            conflicts.push(edit.target);
            continue;
        }
        if (edit.target.startsWith("edge:")) {
            mergeEdge(edit, next, output, conflicts);
        } else {
            mergeContent(edit.target, base, human, next, output, conflicts);
        }
    }
    return { output, conflicts: [...new Set(conflicts)] };
}

function mergeEdge(
    edit: ViewEditOperation,
    next: Map<string, unknown>,
    output: ViewSynthesisOutput,
    conflicts: string[],
): void {
    const identity = edit.target.slice(5);
    const proposed = next.get(edit.target) as ViewRelationshipInput | undefined;
    const old = edit.oldValue as ViewRelationshipInput | undefined;
    const human = edit.newValue as ViewRelationshipInput | undefined;
    if (edit.operation === "delete") {
        // Re-identification and source revision refresh cannot defeat a human removal.
        output.relationships = output.relationships.filter(
            (edge) => edgeIdentity(edge) !== identity,
        );
        return;
    }
    if (
        old &&
        proposed &&
        viewHash({ ...old, id: proposed.id }) !== viewHash(proposed) &&
        viewHash(human) !== viewHash(proposed)
    ) {
        conflicts.push(edit.target);
        return;
    }
    output.relationships = output.relationships.filter(
        (edge) => edgeIdentity(edge) !== identity,
    );
    if (human) output.relationships.push(structuredClone(human));
}

function mergeContent(
    target: string,
    base: Map<string, unknown>,
    human: Map<string, unknown>,
    next: Map<string, unknown>,
    output: ViewSynthesisOutput,
    conflicts: string[],
): void {
    const old = base.get(target);
    const edited = human.get(target);
    const proposed = next.get(target);
    let merged = mergeValue(old, edited, proposed);
    if (target.startsWith("section:") && old && edited && proposed)
        merged = mergeSection(
            old as TroubleshootingGuideContent["sections"][number],
            edited as TroubleshootingGuideContent["sections"][number],
            proposed as TroubleshootingGuideContent["sections"][number],
        );
    const deletion =
        edited === undefined &&
        (proposed === undefined || viewHash(proposed) === viewHash(old));
    if (
        merged === undefined &&
        !deletion &&
        !(edited === undefined && proposed === undefined)
    ) {
        conflicts.push(target);
        return;
    }
    if (target.startsWith("section:")) {
        const id = target.slice(8);
        const index = output.content.sections.findIndex(
            (section) => section.id === id,
        );
        if (merged === undefined)
            output.content.sections = output.content.sections.filter(
                (section) => section.id !== id,
            );
        else if (index < 0)
            output.content.sections.push(
                merged as TroubleshootingGuideContent["sections"][number],
            );
        else
            output.content.sections[index] =
                merged as TroubleshootingGuideContent["sections"][number];
    } else if (target === "title") output.content.title = merged as string;
    else if (target === "summary") {
        if (merged === undefined) delete output.content.summary;
        else output.content.summary = merged as string;
    } else if (target === "citations")
        output.content.citations =
            merged as TroubleshootingGuideContent["citations"];
}

export function rebaseViewEdits(
    current: ViewVersion | undefined,
    candidate: ViewSynthesisOutput,
    merged: ViewSynthesisOutput,
    candidateId: string,
): ViewEditOperation[] {
    const base = values(candidate.content, candidate.relationships);
    const next = values(merged.content, merged.relationships);
    return (current?.edits ?? []).map((edit) => {
        if (edit.status === "cleared") return edit;
        const oldValue = base.get(edit.target);
        const newValue = next.get(edit.target);
        return {
            ...edit,
            generatedBaseId: candidateId,
            baseFingerprint: viewHash(candidate.content),
            oldHash: viewHash(oldValue),
            oldValue,
            newValue,
            status: "merged",
        };
    });
}

export function reconcileResolutionEdits(
    current: ViewVersion,
    rebased: ViewEditOperation[],
    fresh: ViewEditOperation[],
    output: ViewSynthesisOutput,
): ViewEditOperation[] {
    const human = values(
        current.content as TroubleshootingGuideContent,
        authoredRelationships(current),
    );
    const resolved = values(output.content, output.relationships);
    const additions = new Map(fresh.map((edit) => [edit.target, edit]));
    const retained = rebased.map((edit): ViewEditOperation => {
        if (edit.status === "cleared") return edit;
        if (
            viewHash(human.get(edit.target)) ===
            viewHash(resolved.get(edit.target))
        ) {
            additions.delete(edit.target);
            return edit;
        }
        return { ...edit, status: "cleared" };
    });
    return [...retained, ...additions.values()];
}
