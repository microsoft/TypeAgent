import { KnowledgeResponse, ConcreteEntity, Facet } from "./knowledgeSchema.js";
import { createSemanticMap } from "typeagent";

function getUniqueElements(arr1: string[], arr2: string[]): string[] {
    return Array.from(new Set([...arr1, ...arr2]));
}

class NormalizedEntities {
    entitiesByName: Map<string, ConcreteEntity> = new Map();
    constructor(public entities: ConcreteEntity[]) {
        for (const entity of entities) {
            let namedEntity = this.entitiesByName.get(entity.name);
            if (namedEntity) {
                // merge the new entity into the existing entity
                namedEntity = this.mergeEntities(namedEntity, entity);
            } else {
                namedEntity = entity;
            }
            this.entitiesByName.set(entity.name, namedEntity!);
        }
    }

    combineFacets(facets1: Facet[] = [], facets2: Facet[] = []): Facet[] {
        const facetsByName = new Map<string, Facet>();
        const outFacets: Facet[] = [];

        for (const facet of facets1) {
            facetsByName.set(facet.name, facet);
            outFacets.push(facet);
        }
        for (const facet of facets2) {
            const existingFacet = facetsByName.get(facet.name);
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

class NormalizedKnowledgeResponse {
    entities: NormalizedEntities;
    constructor(public response: KnowledgeResponse) {
        this.entities = new NormalizedEntities(response.entities);
    }
}

function facetLoss(facetsA: Facet[], facetsB: Facet[]): number {
    let loss = 0;
    const aMap = new Map<string, Facet>();
    for (const facet of facetsA) {
        aMap.set(facet.name, facet);
    }
    for (const bFacet of facetsB) {
        const aFacet = aMap.get(bFacet.name);
        if (!aFacet) {
            loss += 1;
        } else {
            if (aFacet.value !== bFacet.value) {
                loss += 1;
            }
        }
    }
    return loss;
}

function entityLoss(
    entitiesA: NormalizedEntities,
    entitiesB: NormalizedEntities,
) {
    let loss = 0;
    for (const entity of entitiesA.entities) {
        const entityB = entitiesB.entitiesByName.get(entity.name);
        if (!entityB) {
            loss += 3;
        } else {
            if (entity.type !== entityB.type) {
                loss += 1;
            }
            if (entity.facets) {
                if (!entityB.facets) {
                    loss += 1;
                } else {
                    loss += facetLoss(entity.facets, entityB.facets);
                }
            }
        }
    }
    return loss;
}

// compute the loss between the reference response and the candidate response on a scale of 0 to 1
export function knowledgeResponseLoss(
    refResponse: KnowledgeResponse,
    candidateResponse: KnowledgeResponse,
): number {
    let loss = 0;
    const refNorm = new NormalizedKnowledgeResponse(refResponse);
    const candidateNorm = new NormalizedKnowledgeResponse(candidateResponse);

    return loss;
}
