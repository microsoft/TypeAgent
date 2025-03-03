// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Tag,
} from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { IPropertyToSemanticRefIndex } from "./interfaces.js";
import { TextRangesInScope } from "./collections.js";
import { facetValueToString } from "./knowledge.js";

export enum PropertyNames {
    EntityName = "name",
    EntityType = "type",
    FacetName = "facet.name",
    FacetValue = "facet.value",
    Verb = "verb",
    Subject = "subject",
    Object = "object",
    IndirectObject = "indirectObject",
    Tag = "tag",
}

function addFacet(
    facet: kpLib.Facet | undefined,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    if (facet !== undefined) {
        propertyIndex.addProperty(
            PropertyNames.FacetName,
            facet.name,
            semanticRefIndex,
        );
        if (facet.value !== undefined) {
            propertyIndex.addProperty(
                PropertyNames.FacetValue,
                facetValueToString(facet),
                semanticRefIndex,
            );
        }
    }
}

export function addEntityPropertiesToIndex(
    entity: kpLib.ConcreteEntity,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    propertyIndex.addProperty(
        PropertyNames.EntityName,
        entity.name,
        semanticRefIndex,
    );
    for (const type of entity.type) {
        propertyIndex.addProperty(
            PropertyNames.EntityType,
            type,
            semanticRefIndex,
        );
    }
    // add every facet name as a separate term
    if (entity.facets && entity.facets.length > 0) {
        for (const facet of entity.facets) {
            addFacet(facet, propertyIndex, semanticRefIndex);
        }
    }
}

export function addActionPropertiesToIndex(
    action: kpLib.Action,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefIndex: SemanticRefIndex,
) {
    propertyIndex.addProperty(
        PropertyNames.Verb,
        action.verbs.join(" "),
        semanticRefIndex,
    );
    if (action.subjectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.Subject,
            action.subjectEntityName,
            semanticRefIndex,
        );
    }
    if (action.objectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.Object,
            action.objectEntityName,
            semanticRefIndex,
        );
    }
    if (action.indirectObjectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.IndirectObject,
            action.indirectObjectEntityName,
            semanticRefIndex,
        );
    }
}

export function buildPropertyIndex(conversation: IConversation) {
    if (conversation.secondaryIndexes && conversation.semanticRefs) {
        conversation.secondaryIndexes.propertyToSemanticRefIndex ??=
            new PropertyIndex();
        addToPropertyIndex(
            conversation.secondaryIndexes.propertyToSemanticRefIndex,
            conversation.semanticRefs,
            0,
        );
    }
}

export function addToPropertyIndex(
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefs: SemanticRef[],
    baseSemanticRefIndex: SemanticRefIndex,
) {
    for (let i = 0; i < semanticRefs.length; ++i) {
        const semanticRef = semanticRefs[i];
        const semanticRefIndex: SemanticRefIndex = i + baseSemanticRefIndex;
        switch (semanticRef.knowledgeType) {
            default:
                break;
            case "action":
                addActionPropertiesToIndex(
                    semanticRef.knowledge as kpLib.Action,
                    propertyIndex,
                    semanticRefIndex,
                );
                break;
            case "entity":
                addEntityPropertiesToIndex(
                    semanticRef.knowledge as kpLib.ConcreteEntity,
                    propertyIndex,
                    semanticRefIndex,
                );
                break;
            case "tag":
                const tag = semanticRef.knowledge as Tag;
                propertyIndex.addProperty(
                    PropertyNames.Tag,
                    tag.text,
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
            const nv = this.termTextToNameValue(key);
            terms.push(nv[1]);
        }
        return terms;
    }

    public addProperty(
        propertyName: string,
        value: string,
        semanticRefIndex: SemanticRefIndex | ScoredSemanticRef,
    ): void {
        let termText = this.toPropertyTermText(propertyName, value);
        if (typeof semanticRefIndex === "number") {
            semanticRefIndex = {
                semanticRefIndex: semanticRefIndex,
                score: 1,
            };
        }
        termText = this.prepareTermText(termText);
        if (this.map.has(termText)) {
            this.map.get(termText)?.push(semanticRefIndex);
        } else {
            this.map.set(termText, [semanticRefIndex]);
        }
    }

    public clear(): void {
        this.map.clear();
    }

    lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRef[] | undefined {
        const termText = this.toPropertyTermText(propertyName, value);
        return this.map.get(this.prepareTermText(termText)) ?? [];
    }

    /**
     * Do any pre-processing of the term.
     * @param termText
     */
    private prepareTermText(termText: string): string {
        return termText.toLowerCase();
    }

    private toPropertyTermText(name: string, value: string) {
        return makePropertyTermText(name, value);
    }

    private termTextToNameValue(termText: string): [string, string] {
        return splitPropertyTermText(termText);
    }
}

export function lookupPropertyInPropertyIndex(
    propertyIndex: IPropertyToSemanticRefIndex,
    propertyName: string,
    propertyValue: string,
    semanticRefs: SemanticRef[],
    rangesInScope?: TextRangesInScope,
): ScoredSemanticRef[] | undefined {
    let scoredRefs = propertyIndex.lookupProperty(propertyName, propertyValue);
    if (scoredRefs && scoredRefs.length > 0 && rangesInScope) {
        scoredRefs = scoredRefs.filter((sr) =>
            rangesInScope.isRangeInScope(
                semanticRefs[sr.semanticRefIndex].range,
            ),
        );
    }
    return scoredRefs;
}

const PropertyDelimiter = "@@";
function makePropertyTermText(name: string, value: string) {
    return `prop.${name}${PropertyDelimiter}${value}`;
}

function splitPropertyTermText(termText: string): [string, string] {
    const parts = termText.split(PropertyDelimiter);
    return [parts[0], parts[1]];
}
