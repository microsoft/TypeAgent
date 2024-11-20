// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "aiclient";
import {
    KnowledgeResponse,
    ConcreteEntity,
    Action,
    Facet,
    VerbTense,
    ActionParam,
} from "./knowledgeSchema.js";
import { createSemanticMap } from "typeagent";

export async function createLocalSemanticMap<T>(_model: TextEmbeddingModel) {
    const map = new Map<string, T>();
    return {
        setMultiple(items: [string, T][]) {
            for (const [key, value] of items) {
                map.set(key, value);
            }
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

function getUniqueElements<T>(
    arr1: T[] | undefined,
    arr2: T[] | undefined,
): T[] {
    if (!arr1) {
        return arr2 || [];
    } else if (!arr2) {
        return arr1;
    } else {
        return Array.from(new Set([...arr1, ...arr2]));
    }
}

function normalizeString(s: string): string {
    return s.toLowerCase();
}

function normalizeActionName(verbs: string[]): string {
    return normalizeString(verbs.join(" "));
}

interface NormalizedAction {
    verbs: string[];
    verbTense: VerbTense;
    params?: (string | ActionParam)[] | undefined;
    subjectEntityNames?: string[] | undefined;
    objectEntityNames?: string[] | undefined;
    indirectObjectEntityNames?: string[] | undefined;
    subjectEntityFacets?: Facet[] | undefined;
}

function normalizeAction(action: Action): NormalizedAction {
    return {
        verbs: action.verbs,
        verbTense: action.verbTense,
        params: action.params,
        subjectEntityFacet: action.subjectEntityFacet,
        subjectEntityName: [action.subjectEntityName],
        objectEntityName: [action.objectEntityName],
        indirectObjectEntityName: [action.indirectObjectEntityName],
    } as NormalizedAction;
}

class NormalizedActions {
    actionsByName: Map<string, NormalizedAction> = new Map();
    constructor(public actions: Action[]) {
        for (const action of actions) {
            const normName = normalizeActionName(action.verbs);
            let namedAction = this.actionsByName.get(normName);
            if (namedAction) {
                // merge the new action into the existing action
                namedAction = this.mergeActionsToNorm(namedAction, action);
            } else {
                namedAction = normalizeAction(action);
            }
            this.actionsByName.set(normName, namedAction);
        }
    }

    mergeActionsToNorm(
        normAction: NormalizedAction,
        action2: Action,
    ): NormalizedAction {
        return {
            verbs: normAction.verbs,
            verbTense: normAction.verbTense,
            params: getUniqueElements(normAction.params, action2.params),
            subjectEntityNames: getUniqueElements(
                normAction.subjectEntityNames,
                [action2.subjectEntityName],
            ),
            objectEntityNames: getUniqueElements(normAction.objectEntityNames, [
                action2.objectEntityName,
            ]),
            indirectObjectEntityNames: getUniqueElements(
                normAction.indirectObjectEntityNames,
                [action2.indirectObjectEntityName],
            ),
            subjectEntityFacets: normAction.subjectEntityFacets?.concat(
                action2.subjectEntityFacet || [],
            ),
        };
    }
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

async function stringListLoss(
    refStrings: string[] | undefined,
    genStrings: string[] | undefined,
    model: TextEmbeddingModel,
) {
    if (!refStrings) {
        return 0;
    }
    if (!genStrings) {
        return 1;
    }
    if (refStrings.length === 0) {
        return 0;
    }
    const map = await createSemanticMap<string>(model);
    map.setMultiple(genStrings.map((s) => [s, s]));
    let loss = 0;
    for (const str of refStrings) {
        const nearest = await map.getNearest(str);
        if (nearest === undefined) {
            loss += 1;
        } else {
            loss += 1 - nearest.score;
        }
    }
    return loss / refStrings.length;
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
    refFacets: Facet[] | undefined,
    genFacets: Facet[],
    model: TextEmbeddingModel,
) {
    let loss = 0;
    let potentialNameLoss = 2;
    let potentialValueLoss = 1;
    let potentialLoss = potentialNameLoss + potentialValueLoss;
    if (!refFacets || refFacets.length === 0) {
        console.log("no ref facets");
        return 0;
    }
    let potentialLossTotal = refFacets.length * potentialLoss;
    const genMap = await createSemanticMap<Facet>(model);
    genMap.setMultiple(genFacets.map((facet) => [facet.name, facet]));
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
    return stringListLoss(refType, genType, model);
}

async function entityLoss(
    refEntities: NormalizedEntities,
    generatedEntities: NormalizedEntities,
    model: TextEmbeddingModel,
) {
    if (refEntities.entities.length === 0) {
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
    genMap.setMultiple(
        generatedEntities.entities.map((entity) => [entity.name, entity]),
    );
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

async function paramsLoss(
    refParams: (string | ActionParam)[],
    genParams: (string | ActionParam)[],
    model: TextEmbeddingModel,
) {
    const potentialLossName = 2;
    const potentialLossValue = 1;
    const potentialLossPerParam = potentialLossName + potentialLossValue;
    const potentialLossTotal = potentialLossPerParam * refParams.length;
    if (refParams.length === 0) {
        return 0;
    }
    let loss = 0;
    const genMap = await createSemanticMap<string | ActionParam>(model);
    genMap.setMultiple(
        genParams.map((param) => {
            if (typeof param === "string") {
                return [param, param];
            } else {
                return [param.name, param];
            }
        }),
    );
    for (const param of refParams) {
        let paramName: string;
        if (typeof param === "string") {
            paramName = param;
        } else {
            paramName = param.name;
        }
        const genParamScored = await genMap.getNearest(paramName);
        if (genParamScored === undefined) {
            loss += potentialLossPerParam;
        } else {
            loss += potentialLossName * (1 - genParamScored.score);
            if (typeof param !== "string") {
                const genParam = genParamScored.item.valueOf() as ActionParam;
                if (param.value !== genParam.value) {
                    loss += potentialLossValue;
                }
            }
        }
    }
    return loss / potentialLossTotal;
}
async function actionsLoss(
    refActions: NormalizedAction[],
    genActions: NormalizedAction[],
    model: TextEmbeddingModel,
) {
    const potentialVerbLoss = 5;
    const potentialVerbTenseLoss = 2;
    const potentialParamLoss = 1;
    // include subject, object, and indirect object
    const potentialSubjectLoss = 1;
    const potentialObjectLoss = 1;
    const potentialIndirectObjectLoss = 1;
    const potentialSubjectEntityFacetLoss = 1;
    const potentialLossPerAction =
        potentialVerbLoss +
        potentialVerbTenseLoss +
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
    const genMap = await createSemanticMap<NormalizedAction>(model);
    genMap.setMultiple(
        genActions.map((action) => [normalizeActionName(action.verbs), action]),
    );
    for (const action of refActions) {
        const normName = normalizeActionName(action.verbs);
        const genActionScored = await genMap.getNearest(normName);
        if (genActionScored === undefined) {
            loss += potentialLossPerAction;
        } else {
            loss += potentialVerbLoss * (1 - genActionScored.score);
            const genAction = genActionScored.item;
            if (action.verbTense !== genAction.verbTense) {
                loss += potentialVerbTenseLoss;
            }
            if (action.params) {
                if (!genAction.params) {
                    loss += potentialParamLoss;
                } else {
                    const prmsLoss = await paramsLoss(
                        action.params,
                        genAction.params,
                        model,
                    );
                    loss += potentialParamLoss * prmsLoss;
                }
            }
            const subjLoss = await stringListLoss(
                action.subjectEntityNames,
                genAction.subjectEntityNames,
                model,
            );
            loss += potentialSubjectLoss * subjLoss;
            const objLoss = await stringListLoss(
                action.objectEntityNames,
                genAction.objectEntityNames,
                model,
            );
            loss += potentialObjectLoss * objLoss;
            const indObjLoss = await stringListLoss(
                action.indirectObjectEntityNames,
                genAction.indirectObjectEntityNames,
                model,
            );
            loss += potentialIndirectObjectLoss * indObjLoss;
            if (action.subjectEntityFacets) {
                if (!genAction.subjectEntityFacets) {
                    loss += potentialSubjectEntityFacetLoss;
                } else {
                    const genFacetLoss = await facetLoss(
                        action.subjectEntityFacets,
                        genAction.subjectEntityFacets,
                        model,
                    );
                    loss += potentialSubjectEntityFacetLoss * genFacetLoss;
                }
            }
        }
    }
    return loss / potentialLossTotal;
}

class NormalizedKnowledgeResponse {
    entities: NormalizedEntities;
    actions: NormalizedActions;
    constructor(public response: KnowledgeResponse) {
        this.entities = new NormalizedEntities(response.entities);
        this.actions = new NormalizedActions(response.actions);
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
        let topicLoss = await stringListLoss(
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

interface IGatheredTerms {
    terms: string[];
    structureTerms: string[];
}

export function gatherTerms(knowledge: KnowledgeResponse): IGatheredTerms {
    const termsSet = new Set<string>();
    const structuredTermsSet = new Set<string>();

    function addTerm(term: string) {
        termsSet.add(term);
    }

    function addStructuredTerm(term: string) {
        addTerm(term);
        structuredTermsSet.add(term);
    }

    function addFacet(facet: Facet) {
        addStructuredTerm(facet.name);
        if (typeof facet.value === "string") {
            addStructuredTerm(facet.value);
        } else if (typeof facet.value === "object") {
            addStructuredTerm(facet.value.units);
        }
    }

    for (const entity of knowledge.entities) {
        addTerm(entity.name);
        for (const type of entity.type) {
            addStructuredTerm(type);
        }
        if (entity.facets) {
            entity.facets.forEach(addFacet);
        }
    }
    for (const action of knowledge.actions) {
        addTerm(normalizeActionName(action.verbs));
        if (action.params) {
            for (const param of action.params) {
                if (typeof param === "string") {
                    addStructuredTerm(param);
                } else {
                    addStructuredTerm(param.name);
                    if (typeof param.value === "string") {
                        addStructuredTerm(param.toString());
                    } else if (typeof param.value === "object") {
                        addStructuredTerm(param.value.units);
                    }
                }
            }
        }
        if (action.subjectEntityName !== "none") {
            addStructuredTerm(action.subjectEntityName);
        }
        if (action.objectEntityName !== "none") {
            addStructuredTerm(action.objectEntityName);
        }
        if (action.indirectObjectEntityName !== "none") {
            addStructuredTerm(action.indirectObjectEntityName);
        }
        if (action.subjectEntityFacet) {
            addFacet(action.subjectEntityFacet);
        }
    }
    for (const topic of knowledge.topics) {
        termsSet.add(topic);
    }
    return {
        terms: Array.from(termsSet),
        structureTerms: Array.from(structuredTermsSet),
    };
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

// compute the simple loss between the reference response and the candidate response on a scale of 0 to 1

export async function simpleKnowledgeResponseLoss(
    refResponse: KnowledgeResponse,
    generatedResponse: KnowledgeResponse,
    model: TextEmbeddingModel,
) {
    const potentialTermsLoss = 2;
    const potentialStructuredTermsLoss = 1;
    const potentialLossTotal =
        potentialTermsLoss + potentialStructuredTermsLoss;
    const refTerms = gatherTerms(refResponse);
    const genTerms = gatherTerms(generatedResponse);
    const termsLoss = await stringListLoss(
        refTerms.terms,
        genTerms.terms,
        model,
    );
    const structuredTermsLoss = await stringListLoss(
        refTerms.structureTerms,
        genTerms.structureTerms,
        model,
    );
    return (
        (termsLoss * potentialTermsLoss +
            structuredTermsLoss * potentialStructuredTermsLoss) /
        potentialLossTotal
    );
}
