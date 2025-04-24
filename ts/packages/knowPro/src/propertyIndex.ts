// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    ListIndexingResult,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    SemanticRefOrdinal,
    Tag,
} from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { IPropertyToSemanticRefIndex } from "./interfaces.js";
import { TextRangesInScope } from "./collections.js";
import { facetValueToString } from "./knowledgeLib.js";

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
    semanticRefOrdinal: SemanticRefOrdinal,
) {
    if (facet !== undefined) {
        propertyIndex.addProperty(
            PropertyNames.FacetName,
            facet.name,
            semanticRefOrdinal,
        );
        if (facet.value !== undefined) {
            propertyIndex.addProperty(
                PropertyNames.FacetValue,
                facetValueToString(facet),
                semanticRefOrdinal,
            );
        }
    }
}

export function addEntityPropertiesToIndex(
    entity: kpLib.ConcreteEntity,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefOrdinal: SemanticRefOrdinal,
) {
    propertyIndex.addProperty(
        PropertyNames.EntityName,
        entity.name,
        semanticRefOrdinal,
    );
    for (const type of entity.type) {
        propertyIndex.addProperty(
            PropertyNames.EntityType,
            type,
            semanticRefOrdinal,
        );
    }
    // add every facet name as a separate term
    if (entity.facets && entity.facets.length > 0) {
        for (const facet of entity.facets) {
            addFacet(facet, propertyIndex, semanticRefOrdinal);
        }
    }
}

export function addActionPropertiesToIndex(
    action: kpLib.Action,
    propertyIndex: IPropertyToSemanticRefIndex,
    semanticRefOrdinal: SemanticRefOrdinal,
) {
    propertyIndex.addProperty(
        PropertyNames.Verb,
        action.verbs.join(" "),
        semanticRefOrdinal,
    );
    if (action.subjectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.Subject,
            action.subjectEntityName,
            semanticRefOrdinal,
        );
    }
    if (action.objectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.Object,
            action.objectEntityName,
            semanticRefOrdinal,
        );
    }
    if (action.indirectObjectEntityName !== "none") {
        propertyIndex.addProperty(
            PropertyNames.IndirectObject,
            action.indirectObjectEntityName,
            semanticRefOrdinal,
        );
    }
}

export function buildPropertyIndex(
    conversation: IConversation,
): ListIndexingResult {
    return addToPropertyIndex(conversation, 0);
}

export function addToPropertyIndex(
    conversation: IConversation,
    startAtOrdinal: SemanticRefOrdinal,
): ListIndexingResult {
    if (conversation.secondaryIndexes && conversation.semanticRefs) {
        conversation.secondaryIndexes.propertyToSemanticRefIndex ??=
            new PropertyIndex();
        const propertyIndex =
            conversation.secondaryIndexes.propertyToSemanticRefIndex;
        const semanticRefs = conversation.semanticRefs;
        for (let i = startAtOrdinal; i < semanticRefs.length; ++i) {
            const semanticRef = semanticRefs[i];
            const semanticRefOrdinal: SemanticRefOrdinal = i;
            switch (semanticRef.knowledgeType) {
                default:
                    break;
                case "action":
                    addActionPropertiesToIndex(
                        semanticRef.knowledge as kpLib.Action,
                        propertyIndex,
                        semanticRefOrdinal,
                    );
                    break;
                case "entity":
                    addEntityPropertiesToIndex(
                        semanticRef.knowledge as kpLib.ConcreteEntity,
                        propertyIndex,
                        semanticRefOrdinal,
                    );
                    break;
                case "tag":
                    const tag = semanticRef.knowledge as Tag;
                    propertyIndex.addProperty(
                        PropertyNames.Tag,
                        tag.text,
                        semanticRefOrdinal,
                    );
                    break;
            }
        }
        return {
            numberCompleted: semanticRefs.length - startAtOrdinal,
        };
    }
    return { numberCompleted: 0 };
}

export class PropertyIndex implements IPropertyToSemanticRefIndex {
    private map: Map<string, ScoredSemanticRefOrdinal[]> = new Map();

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
        semanticRefOrdinal: SemanticRefOrdinal | ScoredSemanticRefOrdinal,
    ): void {
        let termText = this.toPropertyTermText(propertyName, value);
        if (typeof semanticRefOrdinal === "number") {
            semanticRefOrdinal = {
                semanticRefOrdinal: semanticRefOrdinal,
                score: 1,
            };
        }
        termText = this.prepareTermText(termText);
        if (this.map.has(termText)) {
            this.map.get(termText)?.push(semanticRefOrdinal);
        } else {
            this.map.set(termText, [semanticRefOrdinal]);
        }
    }

    public clear(): void {
        this.map.clear();
    }

    public lookupProperty(
        propertyName: string,
        value: string,
    ): ScoredSemanticRefOrdinal[] | undefined {
        const termText = this.toPropertyTermText(propertyName, value);
        return this.map.get(this.prepareTermText(termText));
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
): ScoredSemanticRefOrdinal[] | undefined {
    let scoredRefs = propertyIndex.lookupProperty(propertyName, propertyValue);
    if (scoredRefs && scoredRefs.length > 0 && rangesInScope) {
        scoredRefs = scoredRefs.filter((sr) =>
            rangesInScope.isRangeInScope(
                semanticRefs[sr.semanticRefOrdinal].range,
            ),
        );
    }
    return scoredRefs;
}

export function isKnownProperty(
    propertyIndex: IPropertyToSemanticRefIndex | undefined,
    propertyName: PropertyNames,
    propertyValue: string,
): boolean {
    if (propertyIndex) {
        const semanticRefsWithName = propertyIndex.lookupProperty(
            propertyName,
            propertyValue,
        );
        return (
            semanticRefsWithName !== undefined &&
            semanticRefsWithName.length > 0
        );
    }
    return false;
}

const PropertyDelimiter = "@@";
function makePropertyTermText(name: string, value: string) {
    return `prop.${name}${PropertyDelimiter}${value}`;
}

function splitPropertyTermText(termText: string): [string, string] {
    const parts = termText.split(PropertyDelimiter);
    return [parts[0], parts[1]];
}
