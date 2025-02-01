// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IPropertyToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";
import { conversation } from "knowledge-processor";

function addFacet(
    facet: conversation.Facet | undefined,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    if (facet !== undefined) {
        propertyIndex.addProperty(
            "entity.facet.name",
            facet.name,
            semanticRefIndex,
        );
        if (facet.value !== undefined) {
            propertyIndex.addProperty(
                "entity.facet",
                conversation.knowledgeValueToString(facet.value),
                semanticRefIndex,
            );
        }
    }
}

export function addEntityPropertiesToIndex(
    entity: conversation.ConcreteEntity,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    propertyIndex.addProperty("entity.name", entity.name, semanticRefIndex);
    for (const type of entity.type) {
        propertyIndex.addProperty("entity.type", type, semanticRefIndex);
    }
    // add every facet name as a separate term
    if (entity.facets && entity.facets.length > 0) {
        for (const facet of entity.facets) {
            addFacet(facet, propertyIndex, semanticRefIndex);
        }
    }
}

export function addActionPropertiesToIndex(
    action: conversation.Action,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    propertyIndex.addProperty(
        "action.verb",
        action.verbs.join(" "),
        semanticRefIndex,
    );
    if (action.subjectEntityName !== "none") {
        propertyIndex.addProperty(
            "action.subject",
            action.subjectEntityName,
            semanticRefIndex,
        );
    }
    if (action.objectEntityName !== "none") {
        propertyIndex.addProperty(
            "action.object",
            action.objectEntityName,
            semanticRefIndex,
        );
    }
    if (action.indirectObjectEntityName !== "none") {
        propertyIndex.addProperty(
            "action.indirectObject",
            action.indirectObjectEntityName,
            semanticRefIndex,
        );
    }
}

export function addPropertiesToIndex(
    semanticRefs: SemanticRef[],
    propertyIndex: IPropertyToSemanticRefIndex,
) {
    for (let i = 0; i < semanticRefs.length; ++i) {
        const semanticRef = semanticRefs[i];
        const semanticRefIndex: SemanticRefIndex = i;
        switch (semanticRef.knowledgeType) {
            default:
                break;
            case "action":
                addActionPropertiesToIndex(
                    semanticRef.knowledge as conversation.Action,
                    propertyIndex,
                    semanticRefIndex,
                );
                break;
            case "entity":
                addEntityPropertiesToIndex(
                    semanticRef.knowledge as conversation.ConcreteEntity,
                    propertyIndex,
                    semanticRefIndex,
                );
                break;
        }
    }
}

export class PropertyIndex implements IPropertyToSemanticRefIndex {
    private map: Map<string, ScoredSemanticRef[]> = new Map();

    constructor() {}

    get size(): number {
        return this.map.size;
    }

    public getValues(): string[] {
        const terms: string[] = [];
        for (const key of this.map.keys()) {
            const nv = this.splitPropertyTerm(key);
            terms.push(nv[1]);
        }
        return terms;
    }

    public addProperty(
        propertyName: string,
        value: string,
        semanticRefIndex: SemanticRefIndex | ScoredSemanticRef,
    ): void {
        let term = this.propertyTerm(propertyName, value);
        if (typeof semanticRefIndex === "number") {
            semanticRefIndex = {
                semanticRefIndex: semanticRefIndex,
                score: 1,
            };
        }
        term = this.prepareTerm(term);
        if (this.map.has(term)) {
            this.map.get(term)?.push(semanticRefIndex);
        } else {
            this.map.set(term, [semanticRefIndex]);
        }
    }

    lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRef[] | undefined {
        const term = this.propertyTerm(propertyName, value);
        return this.map.get(this.prepareTerm(term)) ?? [];
    }

    /**
     * Do any pre-processing of the term.
     * @param term
     */
    private prepareTerm(term: string): string {
        return term.toLowerCase();
    }

    PropertyDelimiter = "@@";
    private propertyTerm(name: string, value: string) {
        return `${name}${this.PropertyDelimiter}${value}`;
    }

    private splitPropertyTerm(term: string): [string, string] {
        const parts = term.split(this.PropertyDelimiter);
        return [parts[0], parts[1]];
    }
}
