// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import {
    ActionTerm,
    EntityTerm,
    SearchFilter,
    SearchQuery,
} from "./searchQuerySchema.js";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { loadSchema } from "typeagent";
import {
    createPropertySearchTerm,
    createSearchTerm,
    SearchTermGroup,
} from "./search.js";
import { PropertyNames } from "./propertyIndex.js";
import { PropertyTermSet } from "./collections.js";

/*-------------------------------

    EXPERIMENTAL CODE
    Frequent changes

---------------------------------*/

export type SearchQueryTranslator = TypeChatJsonTranslator<SearchQuery>;

export function createSearchQueryTranslator(
    model: TypeChatLanguageModel,
): SearchQueryTranslator {
    const typeName = "SearchQuery";
    const searchActionSchema = loadSchema(
        ["dateTimeSchema.ts", "searchQuerySchema.ts"],
        import.meta.url,
    );

    return createJsonTranslator<SearchQuery>(
        model,
        createTypeScriptJsonValidator<SearchQuery>(
            searchActionSchema,
            typeName,
        ),
    );
}

export class SearchGroupBuilder {
    private entityTermsAdded: PropertyTermSet;

    constructor(
        public termGroup: SearchTermGroup = { booleanOp: "or", terms: [] },
    ) {
        this.entityTermsAdded = new PropertyTermSet();
    }

    public clear() {
        this.termGroup.terms = [];
        this.entityTermsAdded.clear();
    }

    public addSearchFilter(filter: SearchFilter): void {
        if (filter.entitySearchTerms) {
            this.addEntityTerms(filter.entitySearchTerms);
        }
        if (filter.actionSearchTerm) {
            this.addActionTerms(filter.actionSearchTerm);
            this.addEntityTermsForAction(filter.actionSearchTerm);
        }
        if (filter.searchTerms) {
            for (const term of filter.searchTerms) {
                this.termGroup.terms.push(createSearchTerm(term));
            }
        }
    }

    private addEntityTerms(entityTerms: EntityTerm[]): void {
        if (entityTerms && entityTerms.length > 0) {
            for (const entityTerm of entityTerms) {
                this.addEntityTerm(entityTerm);
            }
        }
    }

    private addEntityTerm(entityTerm: EntityTerm): void {
        this.addPropertyTerm(PropertyNames.EntityName, entityTerm.name);
        if (entityTerm.type) {
            for (const type of entityTerm.type) {
                this.addPropertyTerm(PropertyNames.EntityType, type);
            }
        }
        if (entityTerm.facets && entityTerm.facets.length > 0) {
            for (const facetTerm of entityTerm.facets) {
                const nameWildcard = isWildcard(facetTerm.facetName);
                const valueWildcard = isWildcard(facetTerm.facetValue);
                if (!(nameWildcard && valueWildcard)) {
                    this.addPropertyTerm(
                        facetTerm.facetName,
                        facetTerm.facetValue,
                    );
                } else if (nameWildcard) {
                    this.addPropertyTerm(
                        PropertyNames.FacetValue,
                        facetTerm.facetValue,
                    );
                } else if (valueWildcard) {
                    this.addPropertyTerm(
                        PropertyNames.FacetName,
                        facetTerm.facetName,
                    );
                }
            }
        }
    }

    private addActionTerms(actionTerm: ActionTerm): void {
        if (actionTerm.actionVerbs) {
            for (const verb of actionTerm.actionVerbs.words) {
                this.addPropertyTerm(PropertyNames.Verb, verb);
            }
        }
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityNames(
                actionTerm.actorEntities,
                PropertyNames.Subject,
            );
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.addEntityNames(
                actionTerm.targetEntities,
                PropertyNames.Object,
            );
            this.addEntityNames(
                actionTerm.targetEntities,
                PropertyNames.IndirectObject,
            );
        }
    }

    private addEntityTermsForAction(actionTerm: ActionTerm): void {
        if (isEntityTermArray(actionTerm.actorEntities)) {
            this.addEntityTerms(actionTerm.actorEntities);
        }
        if (isEntityTermArray(actionTerm.targetEntities)) {
            this.addEntityTerms(actionTerm.targetEntities);
        }
        if (isEntityTermArray(actionTerm.additionalEntities)) {
            this.addEntityTerms(actionTerm.additionalEntities);
        }
    }

    private addEntityNames(
        entityTerms: EntityTerm[],
        propertyName: PropertyNames,
    ): void {
        for (const entityTerm of entityTerms) {
            this.addPropertyTerm(propertyName, entityTerm.name);
        }
    }

    private addPropertyTerm(propertyName: string, propertyValue: string): void {
        if (!isWildcard(propertyValue)) {
            return;
        }
        // Dedupe
        if (!this.entityTermsAdded.has(propertyName, propertyValue)) {
            const searchTerm = createPropertySearchTerm(
                propertyName,
                propertyValue,
            );
            this.termGroup.terms.push(searchTerm);
            this.entityTermsAdded.add(
                propertyName,
                searchTerm.propertyValue.term,
            );
        }
    }
}

const Wildcard = "*";

function isEntityTermArray(
    terms: EntityTerm[] | "*" | undefined,
): terms is EntityTerm[] {
    if (terms !== undefined) {
        if (Array.isArray(terms)) {
            return true;
        } else if (typeof terms === "string") {
            return terms !== Wildcard;
        }
    }
    return false;
}

function isWildcard(value: string | undefined): boolean {
    return value !== undefined && value === Wildcard;
}
