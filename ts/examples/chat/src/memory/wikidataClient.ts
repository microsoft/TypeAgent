// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Minimal SPARQL client for augmenting knowPro entities with Wikidata facts.
 *
 * SPARQL (rather than the action API) is used deliberately so the same code
 * can later target a local Wikibase instance by overriding {@link
 * WikidataClientSettings.endpoint}. The default prefixes below are Wikidata
 * specific; a local Wikibase with different entity base URIs would also need
 * prefix overrides (a future enhancement).
 *
 * Security notes:
 * - QIDs and PIDs are validated against strict regexes before being placed in
 *   a query, so they cannot be used for SPARQL injection.
 * - Free-text search terms are escaped into a SPARQL string literal.
 * - A descriptive User-Agent is sent, as required by the Wikimedia query
 *   service policy.
 */

const DEFAULT_ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_USER_AGENT =
    "TypeAgent-Dream/0.1 (https://github.com/microsoft/TypeAgent; knowPro entity augmentation)";

const SPARQL_PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
PREFIX mwapi: <https://www.mediawiki.org/ontology#API/>
`;

const QID_REGEX = /^Q\d+$/;
const PID_REGEX = /^P\d+$/;

export type WikidataCandidate = {
    qid: string;
    label: string;
    description?: string | undefined;
};

export type WikidataLiteralClaim = {
    propertyId: string;
    propertyLabel: string;
    value: string;
};

export type WikidataRelatedClaim = {
    propertyId: string;
    propertyLabel: string;
    qid: string;
    label: string;
};

export type WikidataClaims = {
    qid: string;
    literals: WikidataLiteralClaim[];
    related: WikidataRelatedClaim[];
};

export type WikidataClientSettings = {
    /** SPARQL endpoint. Override to target a local Wikibase. */
    endpoint: string;
    /** Descriptive User-Agent (Wikimedia policy). */
    userAgent: string;
    /** Default maximum search candidates to return. */
    maxSearchResults: number;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /**
     * When true, search uses the CirrusSearch `EntitySearch` mwapi service
     * (fuzzy, ranked). On failure (e.g. a bare Wikibase without CirrusSearch)
     * it falls back to an exact label match.
     */
    useEntitySearch: boolean;
};

export interface WikidataClient {
    readonly settings: WikidataClientSettings;
    searchEntities(name: string, limit?: number): Promise<WikidataCandidate[]>;
    getEntityClaims(
        qid: string,
        propertyIds?: string[],
    ): Promise<WikidataClaims>;
}

type SparqlValue = {
    type: string;
    value: string;
    "xml:lang"?: string;
    datatype?: string;
};
type SparqlBinding = Record<string, SparqlValue | undefined>;
type SparqlResults = { results: { bindings: SparqlBinding[] } };

export function isValidQid(qid: string): boolean {
    return QID_REGEX.test(qid);
}

export function isValidPid(pid: string): boolean {
    return PID_REGEX.test(pid);
}

export function wikidataUrl(qid: string): string {
    return `https://www.wikidata.org/wiki/${qid}`;
}

/**
 * Escape arbitrary text for safe inclusion inside a double-quoted SPARQL
 * string literal. Backslashes and quotes are escaped; control characters
 * (including newlines that could terminate the literal) are replaced with
 * spaces.
 */
export function sanitizeSparqlLiteral(text: string): string {
    return (
        text
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
    );
}

function entityIdFromIri(iri: string | undefined): string | undefined {
    if (!iri) {
        return undefined;
    }
    const m = /\/entity\/((?:Q|P)\d+)$/.exec(iri);
    return m ? m[1] : undefined;
}

function buildEntitySearchQuery(searchLiteral: string, limit: number): string {
    return (
        SPARQL_PREFIXES +
        `SELECT ?item ?itemLabel ?itemDescription WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${searchLiteral}" .
    bd:serviceParam mwapi:language "en" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`
    );
}

function buildExactLabelQuery(searchLiteral: string, limit: number): string {
    return (
        SPARQL_PREFIXES +
        `SELECT ?item ?itemLabel ?itemDescription WHERE {
  ?item rdfs:label "${searchLiteral}"@en .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`
    );
}

function buildClaimsQuery(qid: string, propertyIds: string[]): string {
    const valuesClause =
        propertyIds.length > 0
            ? `  VALUES ?prop { ${propertyIds.map((p) => `wd:${p}`).join(" ")} }\n`
            : "";
    return (
        SPARQL_PREFIXES +
        `SELECT ?prop ?propLabel ?value ?valueLabel ?isEntity WHERE {
${valuesClause}  ?prop wikibase:directClaim ?wdtProp .
  wd:${qid} ?wdtProp ?value .
  BIND(isIRI(?value) AS ?isEntity)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`
    );
}

export function createWikidataClient(
    settings?: Partial<WikidataClientSettings>,
): WikidataClient {
    const resolved: WikidataClientSettings = {
        endpoint: settings?.endpoint ?? DEFAULT_ENDPOINT,
        userAgent: settings?.userAgent ?? DEFAULT_USER_AGENT,
        maxSearchResults: settings?.maxSearchResults ?? 7,
        timeoutMs: settings?.timeoutMs ?? 15000,
        useEntitySearch: settings?.useEntitySearch ?? true,
    };

    return {
        settings: resolved,
        searchEntities,
        getEntityClaims,
    };

    async function runQuery(query: string): Promise<SparqlResults> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolved.timeoutMs);
        try {
            const response = await fetch(resolved.endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/sparql-results+json",
                    "User-Agent": resolved.userAgent,
                },
                body: "query=" + encodeURIComponent(query),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(
                    `Wikidata SPARQL query failed: ${response.status} ${response.statusText}`,
                );
            }
            return (await response.json()) as SparqlResults;
        } finally {
            clearTimeout(timer);
        }
    }

    async function searchEntities(
        name: string,
        limit?: number,
    ): Promise<WikidataCandidate[]> {
        const searchLiteral = sanitizeSparqlLiteral(name);
        if (searchLiteral.length === 0) {
            return [];
        }
        const max = limit ?? resolved.maxSearchResults;
        let results: SparqlResults;
        if (resolved.useEntitySearch) {
            try {
                results = await runQuery(
                    buildEntitySearchQuery(searchLiteral, max),
                );
            } catch {
                // Fallback for endpoints without the CirrusSearch mwapi service.
                results = await runQuery(
                    buildExactLabelQuery(searchLiteral, max),
                );
            }
        } else {
            results = await runQuery(buildExactLabelQuery(searchLiteral, max));
        }

        const candidates: WikidataCandidate[] = [];
        const seen = new Set<string>();
        for (const binding of results.results.bindings) {
            const qid = entityIdFromIri(binding.item?.value);
            if (!qid || seen.has(qid)) {
                continue;
            }
            seen.add(qid);
            candidates.push({
                qid,
                label: binding.itemLabel?.value ?? qid,
                description: binding.itemDescription?.value,
            });
        }
        return candidates;
    }

    async function getEntityClaims(
        qid: string,
        propertyIds?: string[],
    ): Promise<WikidataClaims> {
        if (!isValidQid(qid)) {
            throw new Error(`Invalid Wikidata QID: ${qid}`);
        }
        const props = (propertyIds ?? []).filter(isValidPid);
        const results = await runQuery(buildClaimsQuery(qid, props));

        const literals: WikidataLiteralClaim[] = [];
        const related: WikidataRelatedClaim[] = [];
        for (const binding of results.results.bindings) {
            const propertyId = entityIdFromIri(binding.prop?.value);
            if (!propertyId) {
                continue;
            }
            const propertyLabel = binding.propLabel?.value ?? propertyId;
            const isEntity = binding.isEntity?.value === "true";
            if (isEntity) {
                const relatedQid = entityIdFromIri(binding.value?.value);
                if (!relatedQid) {
                    continue;
                }
                related.push({
                    propertyId,
                    propertyLabel,
                    qid: relatedQid,
                    label: binding.valueLabel?.value ?? relatedQid,
                });
            } else {
                const value = binding.value?.value;
                if (value === undefined) {
                    continue;
                }
                literals.push({ propertyId, propertyLabel, value });
            }
        }
        return { qid, literals, related };
    }
}

/**
 * An offline {@link WikidataClient} backed by fixtures. Used by `@kpDream
 * --mock` and unit tests so the command can run without network access.
 */
export function createMockWikidataClient(fixtures?: {
    candidates?: Record<string, WikidataCandidate[]>;
    claims?: Record<string, WikidataClaims>;
}): WikidataClient {
    const candidateMap = fixtures?.candidates ?? defaultMockCandidates();
    const claimMap = fixtures?.claims ?? defaultMockClaims();
    const resolved: WikidataClientSettings = {
        endpoint: "mock://wikidata",
        userAgent: DEFAULT_USER_AGENT,
        maxSearchResults: 7,
        timeoutMs: 0,
        useEntitySearch: true,
    };
    return {
        settings: resolved,
        async searchEntities(name: string): Promise<WikidataCandidate[]> {
            return candidateMap[name.trim().toLowerCase()] ?? [];
        },
        async getEntityClaims(qid: string): Promise<WikidataClaims> {
            return claimMap[qid] ?? { qid, literals: [], related: [] };
        },
    };
}

function defaultMockCandidates(): Record<string, WikidataCandidate[]> {
    return {
        "kevin scott": [
            {
                qid: "Q6398097",
                label: "Kevin Scott",
                description: "American technology executive, CTO of Microsoft",
            },
        ],
        microsoft: [
            {
                qid: "Q2283",
                label: "Microsoft",
                description: "American multinational technology corporation",
            },
        ],
    };
}

function defaultMockClaims(): Record<string, WikidataClaims> {
    return {
        Q6398097: {
            qid: "Q6398097",
            literals: [
                {
                    propertyId: "P569",
                    propertyLabel: "date of birth",
                    value: "1972-01-01T00:00:00Z",
                },
            ],
            related: [
                {
                    propertyId: "P31",
                    propertyLabel: "instance of",
                    qid: "Q5",
                    label: "human",
                },
                {
                    propertyId: "P106",
                    propertyLabel: "occupation",
                    qid: "Q82594",
                    label: "computer scientist",
                },
                {
                    propertyId: "P108",
                    propertyLabel: "employer",
                    qid: "Q2283",
                    label: "Microsoft",
                },
            ],
        },
    };
}
