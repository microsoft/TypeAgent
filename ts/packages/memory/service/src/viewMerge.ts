// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { diff3Merge, diffIndices } from "node-diff3";
import { canonicalizeProcedure } from "./agentEdition.js";
import { viewSourceKey } from "./viewContent.js";
import type {
    DerivedViewContent,
    ViewSection,
    ProjectBriefDetails,
    ViewEditOperation,
    ViewRelationshipInput,
    ViewSourceSelector,
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

function fields(content: DerivedViewContent): Map<string, unknown> {
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
    content: DerivedViewContent,
    edges: ViewRelationshipInput[],
): Map<string, unknown> {
    const result = fields(content);
    for (const edge of edges) result.set(`edge:${edgeIdentity(edge)}`, edge);
    return result;
}

export function recordViewEdits(
    current: ViewVersion | undefined,
    content: DerivedViewContent,
    edges: ViewRelationshipInput[],
    actor: string,
): ViewEditOperation[] {
    const prior = current
        ? values(
              current.content as DerivedViewContent,
              authoredRelationships(current),
          )
        : new Map<string, unknown>();
    const next = values(content, edges);
    const base = current?.generation
        ? values(
              current.generation.content as DerivedViewContent,
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
    base: ViewSection,
    human: ViewSection,
    generated: ViewSection,
): ViewSection | undefined {
    const heading = mergeValue(base.heading, human.heading, generated.heading);
    const body = mergeValue(base.body, human.body, generated.body);
    const role = mergeValue(base.role, human.role, generated.role);
    const details = mergeProjectDetails(
        base.details,
        human.details,
        generated.details,
    );
    if (
        typeof heading !== "string" ||
        typeof body !== "string" ||
        typeof role !== "string" ||
        (details === undefined &&
            (base.details || human.details || generated.details))
    )
        return undefined;
    return {
        id: base.id,
        heading,
        body,
        role: role as typeof base.role,
        ...(details
            ? { details: details as NonNullable<ViewSection["details"]> }
            : {}),
    };
}

function mergeTypedField<T>(base: T, human: T, generated: T): T | undefined {
    if (viewHash(human) === viewHash(base)) return generated;
    if (
        viewHash(generated) === viewHash(base) ||
        viewHash(human) === viewHash(generated)
    )
        return human;
    return undefined;
}

function mergeBriefFields<T extends object>(
    base: T,
    human: T,
    generated: T,
    skip: Array<keyof T> = [],
): T | undefined {
    const result = structuredClone(generated);
    for (const key of Object.keys(generated) as Array<keyof T>) {
        if (skip.includes(key)) continue;
        const value = mergeTypedField(base[key], human[key], generated[key]);
        if (value === undefined) return undefined;
        result[key] = value;
    }
    return result;
}

function mergeBriefEntries<T extends { inventoryId: string }>(
    base: T[],
    human: T[],
    generated: T[],
): T[] | undefined {
    const result: T[] = [];
    const ids = new Set(
        [...generated, ...human, ...base].map((entry) => entry.inventoryId),
    );
    for (const id of ids) {
        const old = base.find((entry) => entry.inventoryId === id);
        const edited = human.find((entry) => entry.inventoryId === id);
        const proposed = generated.find((entry) => entry.inventoryId === id);
        if (!edited && (!proposed || viewHash(old) === viewHash(proposed)))
            continue;
        const merged =
            old && edited && proposed
                ? mergeBriefFields(old, edited, proposed)
                : mergeTypedField(old, edited, proposed);
        if (!merged) return undefined;
        result.push(merged);
    }
    return result;
}

function mergeProjectDetails(
    base: ProjectBriefDetails | undefined,
    human: ProjectBriefDetails | undefined,
    generated: ProjectBriefDetails | undefined,
): ProjectBriefDetails | undefined {
    const simple = mergeTypedField(base, human, generated);
    if (simple) return simple;
    if (
        !base ||
        !human ||
        !generated ||
        base.kind !== human.kind ||
        base.kind !== generated.kind
    )
        return undefined;
    switch (generated.kind) {
        case "owners": {
            if (base.kind !== "owners" || human.kind !== "owners")
                return undefined;
            return mergeOwnersDetails(base, human, generated);
        }
        case "milestones": {
            if (base.kind !== "milestones" || human.kind !== "milestones")
                return undefined;
            return mergeBriefItemDetails(base, human, generated);
        }
        case "decisions": {
            if (base.kind !== "decisions" || human.kind !== "decisions")
                return undefined;
            return mergeBriefItemDetails(base, human, generated);
        }
        case "risks": {
            if (base.kind !== "risks" || human.kind !== "risks")
                return undefined;
            return mergeBriefItemDetails(base, human, generated);
        }
        default:
            return mergeBriefFields(base, human, generated);
    }
}

function mergeBriefItemDetails<
    D extends { items: Array<{ inventoryId: string }> },
>(base: D, human: D, generated: D): D | undefined {
    const fields = mergeBriefFields(base, human, generated, ["items"]);
    const items = mergeBriefEntries(base.items, human.items, generated.items);
    if (!fields || !items) return undefined;
    fields.items = items;
    return fields;
}

function mergeOwnersDetails(
    base: Extract<ProjectBriefDetails, { kind: "owners" }>,
    human: Extract<ProjectBriefDetails, { kind: "owners" }>,
    generated: Extract<ProjectBriefDetails, { kind: "owners" }>,
): Extract<ProjectBriefDetails, { kind: "owners" }> | undefined {
    const fields = mergeBriefFields(base, human, generated, ["assignments"]);
    const assignments = mergeBriefEntries(
        base.assignments,
        human.assignments,
        generated.assignments,
    );
    return fields && assignments ? { ...fields, assignments } : undefined;
}

export function mergeView(
    current: ViewVersion | undefined,
    candidate: ViewSynthesisOutput,
    sources: ViewSourceSelector["sources"] = current?.definition.selector
        .sources ?? [],
): {
    output: ViewSynthesisOutput;
    conflicts: string[];
} {
    if (!current) return { output: structuredClone(candidate), conflicts: [] };
    if (current.content.kind !== candidate.content.kind)
        return { output: structuredClone(candidate), conflicts: ["view-kind"] };
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
        current.generation.content as DerivedViewContent,
        current.generation.relationships ?? [],
    );
    const human = values(
        current.content as DerivedViewContent,
        authoredRelationships(current),
    );
    const next = values(candidate.content, candidate.relationships);
    const selected = new Set(sources.map(viewSourceKey));
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
            mergeEdge(edit, next, output, conflicts, selected);
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
    selected: Set<string>,
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
        (human &&
            (!selected.has(viewSourceKey(human.to)) ||
                human.citations.some(
                    (citation) => !selected.has(viewSourceKey(citation)),
                ))) ||
        (proposed &&
            viewHash(old && { ...old, id: proposed.id }) !==
                viewHash(proposed) &&
            viewHash(human && { ...human, id: proposed.id }) !==
                viewHash(proposed))
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
            old as ViewSection,
            edited as ViewSection,
            proposed as ViewSection,
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
        else {
            const section = merged as ViewSection;
            if (output.content.kind === "projectBrief") {
                if (!section.details || section.role !== section.details.kind) {
                    conflicts.push(target);
                    return;
                }
                const typed = {
                    ...section,
                    role: section.details.kind,
                    details: section.details,
                };
                if (index < 0) output.content.sections.push(typed);
                else output.content.sections[index] = typed;
            } else if (index < 0) output.content.sections.push(section);
            else output.content.sections[index] = section;
        }
    } else if (target === "title") output.content.title = merged as string;
    else if (target === "summary") {
        if (merged === undefined) delete output.content.summary;
        else output.content.summary = merged as string;
    } else if (target === "citations")
        output.content.citations = merged as DerivedViewContent["citations"];
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
        current.content as DerivedViewContent,
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
