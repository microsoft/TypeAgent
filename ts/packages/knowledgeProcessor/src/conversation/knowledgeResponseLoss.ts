import { TextEmbeddingModel } from "aiclient";
import {
    KnowledgeResponse,
    ConcreteEntity,
    Action,
    Facet,
} from "./knowledgeSchema.js";
import { createSemanticMap } from "typeagent";

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

async function facetLoss(refFacets: Facet[], genFacets: Facet[]) {
    let loss = 0;
    let potentialNameLoss = 2;
    let potentialValueLoss = 1;
    let potentialLoss = potentialNameLoss + potentialValueLoss;
    let potentialLossTotal = refFacets.length * potentialLoss;
    const genMap = await createSemanticMap<Facet>();
    for (const facet of genFacets) {
        genMap.set(facet.name, facet);
    }
    for (const facet of refFacets) {
        const genFacetScored = await genMap.getNearest(facet.name);
        loss += (1 - genFacetScored.score) * potentialNameLoss;
        const genFacet = genFacetScored.item;
        if (!entityFacetMatch(genFacet.value, facet.value)) {
            loss += potentialValueLoss;
        }
    }
    return loss / potentialLossTotal;
}

async function entityTypeLoss(typeA: string[], typeB: string[]) {
    const map = await createSemanticMap<string>();
    for (const type of typeB) {
        map.set(type, type);
    }
    let loss = 0;
    for (const type of typeA) {
        const nearest = await map.getNearest(type);
        loss += 1 - nearest.score;
    }
    return loss / typeA.length;
}

async function entityLoss(
    refEntities: NormalizedEntities,
    generatedEntities: NormalizedEntities,
    model: TextEmbeddingModel,
) {
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
        loss += potentialNameLoss * (1 - genEntityScored.score);
        const genEntity = genEntityScored.item;
        loss +=
            potentialTypeLoss *
            (await entityTypeLoss(entity.type, genEntity.type));
        if (entity.facets) {
            if (!genEntity.facets) {
                loss += potentialFacetLoss;
            } else {
                const genFacetLoss = await facetLoss(
                    entity.facets,
                    genEntity.facets,
                );
                loss += potentialFacetLoss * genFacetLoss;
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
    const potentialLossTotal = potentialLossPerAction * refActions.length;
    let loss = 0;
    const genMap = await createSemanticMap<Action>(model);
    for (const action of genActions) {
        genMap.set(action.verbs.join(" "), action);
    }
    for (const action of refActions) {
        const genActionScored = await genMap.getNearest(action.verbs.join(" "));
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
                );
                loss += potentialSubjectEntityFacetLoss * genFacetLoss;
            }
        }
    }
    return loss / potentialLossTotal;
}

async function topicsLoss(refTopics: string[], genTopics: string[]) {
    const map = await createSemanticMap<string>();
    for (const topic of genTopics) {
        map.set(topic, topic);
    }
    let loss = 0;
    for (const topic of refTopics) {
        const nearest = await map.getNearest(topic);
        loss += 1 - nearest.score;
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
