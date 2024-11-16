// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "aiclient";
import {
    KnowledgeResponse,
    ConcreteEntity,
    Action,
    Facet,
} from "./knowledgeSchema.js";
// import { createSemanticMap } from "typeagent";

export async function createSemanticMap<T>(_model: TextEmbeddingModel) {
    const map = new Map<string, T>();
    return {
        set: (key: string, value: T) => {
            map.set(key, value);
        },
        get: (key: string) => {
            return map.get(key);
        },
        getNearest: async (key: string) => {
            const item = map.get(key);
            if (item) {
                return { item, score: 1 };
            } else {
                return undefined;
            }
        },
    };
}

function getUniqueElements(arr1: string[], arr2: string[]): string[] {
    return Array.from(new Set([...arr1, ...arr2]));
}

function normalizeString(s: string): string {
    return s.toLowerCase();
}

class NormalizedEntities {
    entitiesByName: Map<string, ConcreteEntity> = new Map();
    constructor(public entities: ConcreteEntity[]) {
        for (const entity of entities) {
            const normName = normalizeString(entity.name);
            let namedEntity = this.entitiesByName.get(normName);
            if (namedEntity) {
                // merge the new entity into the existing entity
                namedEntity = this.mergeEntities(namedEntity, entity);
            } else {
                namedEntity = entity;
            }
            this.entitiesByName.set(normName, namedEntity!);
        }
    }

    combineFacets(facets1: Facet[] = [], facets2: Facet[] = []): Facet[] {
        const facetsByName = new Map<string, Facet>();
        const outFacets: Facet[] = [];

        for (const facet of facets1) {
            facetsByName.set(normalizeString(facet.name), facet);
            outFacets.push(facet);
        }
        for (const facet of facets2) {
            const existingFacet = facetsByName.get(facet.name.toLowerCase());
            if (existingFacet) {
                if (existingFacet.value !== facet.value) {
                    outFacets.push(facet);
                }
            } else {
                outFacets.push(facet);
            }
        }
        return outFacets;
    }

    mergeEntities(
        entity1: ConcreteEntity,
        entity2: ConcreteEntity,
    ): ConcreteEntity {
        return {
            name: entity1.name,
            type: getUniqueElements(entity1.type, entity2.type),
            facets: this.combineFacets(entity1.facets, entity2.facets),
        };
    }
}

function entityFacetMatch(value1: Facet["value"], value2: Facet["value"]) {
    if (typeof value1 === "string" && typeof value2 === "string") {
        return normalizeString(value1) === normalizeString(value2);
    } else if (
        typeof value1 === "number" &&
        typeof value2 === "number" &&
        value1 === value2
    ) {
        return true;
    } else if (
        typeof value1 === "boolean" &&
        typeof value2 === "boolean" &&
        value1 === value2
    ) {
        return true;
    } else if (
        typeof value1 === "object" &&
        typeof value2 === "object" &&
        value1.amount === value2.amount &&
        normalizeString(value1.units) === normalizeString(value2.units)
    ) {
        return true;
    }
    return false;
}

async function facetLoss(
    refFacets: Facet[],
    genFacets: Facet[],
    model: TextEmbeddingModel,
) {
    let loss = 0;
    let potentialNameLoss = 2;
    let potentialValueLoss = 1;
    let potentialLoss = potentialNameLoss + potentialValueLoss;
    if (refFacets.length === 0) {
        console.log("no ref facets");
        return 0;
    }
    let potentialLossTotal = refFacets.length * potentialLoss;
    const genMap = await createSemanticMap<Facet>(model);
    for (const facet of genFacets) {
        genMap.set(facet.name, facet);
    }
    for (const facet of refFacets) {
        const genFacetScored = await genMap.getNearest(facet.name);
        if (genFacetScored === undefined) {
            loss += potentialLoss;
        } else {
            loss += (1 - genFacetScored.score) * potentialNameLoss;

            const genFacet = genFacetScored.item;
            if (!entityFacetMatch(genFacet.value, facet.value)) {
                loss += potentialValueLoss;
            }
        }
    }
    return loss / potentialLossTotal;
}

async function entityTypeLoss(
    refType: string[],
    genType: string[],
    model: TextEmbeddingModel,
) {
    if (refType.length === 0) {
        console.log("no ref types");
        return 0;
    }
    const map = await createSemanticMap<string>(model);
    for (const type of genType) {
        map.set(type, type);
    }
    let loss = 0;
    for (const type of refType) {
        const nearest = await map.getNearest(type);
        if (nearest === undefined) {
            loss += 1;
            console.log("type loss with undef", refType, genType);
        } else {
            loss += 1 - nearest.score;
        }
    }
    const scaledLoss = loss / refType.length;
    if (scaledLoss > 0.01) {
        console.log("type loss", refType, genType, scaledLoss);
    }
    return scaledLoss;
}

async function entityLoss(
    refEntities: NormalizedEntities,
    generatedEntities: NormalizedEntities,
    model: TextEmbeddingModel,
) {
    if (refEntities.entities.length === 0) {
        console.log("no ref entities");
        return 0;
    }
    const potentialNameLoss = 3;
    const potentialTypeLoss = 2;
    const potentialFacetLoss = 1;
    const potentialLossPerEntity =
        potentialNameLoss + potentialTypeLoss + potentialFacetLoss;
    const potentialLossTotal =
        refEntities.entities.length * potentialLossPerEntity;
    const genMap = await createSemanticMap<ConcreteEntity>(model);
    for (const entity of generatedEntities.entities) {
        genMap.set(entity.name, entity);
    }
    let loss = 0;

    for (const entity of refEntities.entities) {
        const genEntityScored = await genMap.getNearest(entity.name);
        if (genEntityScored === undefined) {
            loss += potentialLossPerEntity;
        } else {
            loss += potentialNameLoss * (1 - genEntityScored.score);
            const genEntity = genEntityScored.item;
            loss +=
                potentialTypeLoss *
                (await entityTypeLoss(entity.type, genEntity.type, model));
            if (entity.facets && entity.facets.length > 0) {
                if (!genEntity.facets || genEntity.facets.length === 0) {
                    loss += potentialFacetLoss;
                } else {
                    const genFacetLoss = await facetLoss(
                        entity.facets,
                        genEntity.facets,
                        model,
                    );
                    loss += potentialFacetLoss * genFacetLoss;
                }
            }
        }
    }
    return loss / potentialLossTotal;
}

async function actionsLoss(
    refActions: Action[],
    genActions: Action[],
    model: TextEmbeddingModel,
) {
    const potentialVerbLoss = 5;
    const potentialParamLoss = 1;
    // include subject, object, and indirect object
    const potentialSubjectLoss = 1;
    const potentialObjectLoss = 1;
    const potentialIndirectObjectLoss = 1;
    const potentialSubjectEntityFacetLoss = 1;
    const potentialLossPerAction =
        potentialVerbLoss +
        potentialParamLoss +
        potentialSubjectLoss +
        potentialObjectLoss +
        potentialIndirectObjectLoss +
        potentialSubjectEntityFacetLoss;
    if (refActions.length === 0) {
        return 0;
    }
    const potentialLossTotal = potentialLossPerAction * refActions.length;
    let loss = 0;
    const genMap = await createSemanticMap<Action>(model);
    for (const action of genActions) {
        genMap.set(action.verbs.join(" "), action);
    }
    for (const action of refActions) {
        const genActionScored = await genMap.getNearest(action.verbs.join(" "));
        if (genActionScored === undefined) {
            loss += potentialLossPerAction;
        } else {
            loss += potentialVerbLoss * (1 - genActionScored.score);
            const genAction = genActionScored.item;
            if (action.params) {
                if (!genAction.params) {
                    loss += potentialParamLoss;
                }
                // don't go through params for now
            }
            // exact match for now using normalized string
            if (
                normalizeString(action.subjectEntityName) !==
                normalizeString(genAction.subjectEntityName)
            ) {
                loss += potentialSubjectLoss;
            }
            if (
                normalizeString(action.objectEntityName) !==
                normalizeString(genAction.objectEntityName)
            ) {
                loss += potentialObjectLoss;
            }
            if (
                normalizeString(action.indirectObjectEntityName) !==
                normalizeString(genAction.indirectObjectEntityName)
            ) {
                loss += potentialIndirectObjectLoss;
            }
            if (action.subjectEntityFacet) {
                if (!genAction.subjectEntityFacet) {
                    loss += potentialSubjectEntityFacetLoss;
                } else {
                    const genFacetLoss = await facetLoss(
                        [action.subjectEntityFacet],
                        [genAction.subjectEntityFacet],
                        model,
                    );
                    loss += potentialSubjectEntityFacetLoss * genFacetLoss;
                }
            }
        }
    }
    return loss / potentialLossTotal;
}

async function topicsLoss(
    refTopics: string[],
    genTopics: string[],
    model: TextEmbeddingModel,
) {
    if (refTopics.length === 0) {
        console.log("no ref topics");
        return 0;
    }
    const map = await createSemanticMap<string>(model);
    for (const topic of genTopics) {
        map.set(topic, topic);
    }
    let loss = 0;
    for (const topic of refTopics) {
        const nearest = await map.getNearest(topic);
        if (nearest === undefined) {
            loss += 1;
        } else {
            loss += 1 - nearest.score;
        }
    }
    return loss / refTopics.length;
}

class NormalizedKnowledgeResponse {
    entities: NormalizedEntities;
    constructor(public response: KnowledgeResponse) {
        this.entities = new NormalizedEntities(response.entities);
    }

    async loss(
        normGenResponse: NormalizedKnowledgeResponse,
        model: TextEmbeddingModel,
    ) {
        const potentialEntityLoss = 5;
        const potentialActionLoss = 3;
        const potentialTopicLoss = 1;
        const potentialLossTotal =
            potentialEntityLoss + potentialActionLoss + potentialTopicLoss;
        let genEntityLoss = await entityLoss(
            this.entities,
            normGenResponse.entities,
            model,
        );
        let actionLoss = await actionsLoss(
            this.response.actions,
            normGenResponse.response.actions,
            model,
        );
        let topicLoss = await topicsLoss(
            this.response.topics,
            normGenResponse.response.topics,
            model,
        );
        return (
            (genEntityLoss * potentialEntityLoss +
                actionLoss * potentialActionLoss +
                topicLoss * potentialTopicLoss) /
            potentialLossTotal
        );
    }
}

// compute the loss between the reference response and the candidate response on a scale of 0 to 1
export async function knowledgeResponseLoss(
    refResponse: KnowledgeResponse,
    generatedResponse: KnowledgeResponse,
    model: TextEmbeddingModel,
) {
    const refNorm = new NormalizedKnowledgeResponse(refResponse);
    const genNorm = new NormalizedKnowledgeResponse(generatedResponse);
    return await refNorm.loss(genNorm, model);
}
