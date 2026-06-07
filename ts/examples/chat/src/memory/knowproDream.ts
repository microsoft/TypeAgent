// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `@kpDream` — walk the entities in the loaded knowPro conversation and augment
 * them with types/facets and entity links sourced from Wikidata (via SPARQL).
 *
 * Pipeline:
 *  1. Group entity semantic refs by name.
 *  2. LLM gate: decide which entities are worth a real-world lookup.
 *  3. SPARQL search + (LLM) disambiguation using conversation context.
 *  4. Map curated Wikidata properties onto proposed types/facets/links.
 *  5. Preview (default) or, with --apply, mutate the entities in place and
 *     update the term + property indexes so the new facts are searchable.
 *  6. Automatic LLM deprecation post-pass marks superseded facets `former:<name>`
 *     without deleting them.
 *
 * ---------------------------------------------------------------------------
 * RUNNING THIS COMMAND (verified syntax — keep this current)
 * ---------------------------------------------------------------------------
 * Interactive, from ts/examples/chat:
 *     npm run runchat                 # == node dist/main.js memory
 *     @kpPodcastLoad --name Episode_53_AdrianTchaikovsky
 *     @kpDream --name "Kevin Scott"                       # preview one entity
 *     @kpDream --maxEntities 1000 --apply --linkRelated --save <indexPath>
 *
 * Non-interactive / scripted (no TTY): use the built-in @batch handler. Put the
 * @kp commands (one per line) in a batch file, then pass the whole command as a
 * SINGLE quoted argv token using the NAMED --filePath option and FORWARD
 * slashes (positional bare paths are NOT bound; backslashes get mangled):
 *
 *     node dist/main.js memory "@batch --filePath C:/path/to/dream_batch.txt"
 *
 * Example dream_batch.txt:
 *     @kpPodcastLoad --name Episode_53_dream
 *     @kpDream --maxEntities 1000 --apply --linkRelated --save C:/data/testChat/knowpro/Episode_53_dream_index.json
 */

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    ProgressBar,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import { conversation as kpLib } from "knowledge-processor";
import * as kp from "knowpro";
import chalk from "chalk";
import path from "path";
import { ensureDir, getFileName, loadSchema } from "typeagent";
import {
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    createMockWikidataClient,
    createWikidataClient,
    WikidataCandidate,
    WikidataClient,
    wikidataUrl,
} from "./wikidataClient.js";
import {
    curatedPropertyIds,
    mapClaimsToAugmentation,
    ProposedAugmentation,
} from "./dreamMapping.js";
import type {
    DreamDeprecation,
    DreamDeprecationResponse,
    DreamGateResponse,
    DreamMatchResponse,
} from "./dreamSchema.js";

const MaxGateEntities = 500;
const MaxCoEntities = 30;
// Gate in batches: a single LLM call for hundreds of entities overflows the
// model's output limit and the JSON gets truncated. Smaller batches stay valid.
const GateBatchSize = 30;

type EntityGroup = {
    name: string;
    key: string; // lowercased name
    ordinals: number[];
    entities: kpLib.ConcreteEntity[];
    types: Set<string>; // lowercased existing types
    facetKeys: Set<string>; // lowercased "name=value"
    existingFacets: kpLib.Facet[]; // de-duplicated snapshot (pre-augmentation)
    count: number;
};

type DreamLink = {
    group: EntityGroup; // matched conversation entity
    qid: string;
    label: string;
    propertyLabel: string;
};

type DreamProposal = {
    group: EntityGroup;
    qid: string;
    label: string;
    description?: string | undefined;
    confidence: number;
    augmentation: ProposedAugmentation;
    links: DreamLink[];
};

type DreamTranslators = {
    gate: TypeChatJsonTranslator<DreamGateResponse>;
    match: TypeChatJsonTranslator<DreamMatchResponse>;
    deprecation: TypeChatJsonTranslator<DreamDeprecationResponse>;
};

export async function createKnowproDreamCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    let translators: DreamTranslators | undefined;

    commands.kpDream = dream;
    commands.kpDream.metadata = dreamDef();

    function dreamDef(): CommandMetadata {
        return {
            description:
                "Augment conversation entities with types, facets and links from Wikidata (SPARQL).",
            options: {
                name: arg(
                    "Only augment the entity with this (case-insensitive) name",
                ),
                maxEntities: argNum(
                    "Maximum number of entities to look up",
                    10,
                ),
                minConfidence: argNum(
                    "Minimum disambiguation confidence (0..1)",
                    0.5,
                ),
                apply: argBool(
                    "Apply proposed augmentations to the loaded conversation",
                    false,
                ),
                deprecate: argBool(
                    "Run the automatic LLM deprecation post-pass when applying",
                    true,
                ),
                linkRelated: argBool(
                    "Also add reciprocal links to matched related entities",
                    false,
                ),
                save: arg(
                    "After applying, save the conversation index to this file path",
                ),
                endpoint: arg(
                    "SPARQL endpoint URL (defaults to Wikidata; override for a local Wikibase)",
                ),
                mock: argBool(
                    "Use built-in offline fixtures instead of querying the network",
                    false,
                ),
            },
        };
    }

    async function dream(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, dreamDef());
        const printer = kpContext.printer;
        const conversation = kpContext.conversation;
        if (!conversation) {
            printer.writeError(
                "No conversation loaded. Load one first (e.g. @kpPodcastLoad).",
            );
            return;
        }

        const groups = collectEntityGroups(conversation);
        if (groups.size === 0) {
            printer.writeError("No entities found in the loaded conversation.");
            return;
        }

        const nameFilter = namedArgs.name
            ? String(namedArgs.name).trim().toLowerCase()
            : undefined;

        if (translators === undefined) {
            translators = createDreamTranslators(kpContext.knowledgeModel);
        }

        // Decide which entities to look up.
        let toLookup: { group: EntityGroup; searchQuery: string }[];
        if (nameFilter) {
            const group = groups.get(nameFilter);
            if (!group) {
                printer.writeError(`Entity "${namedArgs.name}" not found.`);
                return;
            }
            toLookup = [{ group, searchQuery: group.name }];
        } else {
            const ranked = [...groups.values()].sort(
                (a, b) => b.count - a.count,
            );
            toLookup = await gateEntities(
                translators,
                ranked,
                namedArgs.maxEntities,
                printer,
            );
        }
        if (toLookup.length === 0) {
            printer.writeLine("Nothing to look up.");
            return;
        }

        const client: WikidataClient = namedArgs.mock
            ? createMockWikidataClient()
            : createWikidataClient(
                  namedArgs.endpoint
                      ? { endpoint: String(namedArgs.endpoint) }
                      : undefined,
              );

        const propertyIds = curatedPropertyIds();
        const coEntityNames = topCoEntityNames(groups);

        const proposals: DreamProposal[] = [];
        // ProgressBar uses stdout.moveCursor, which only exists on a TTY. In
        // batch/redirected runs fall back to plain periodic progress lines.
        const useProgressBar = process.stdout.isTTY === true;
        const progress = useProgressBar
            ? new ProgressBar(printer, toLookup.length)
            : undefined;
        let processed = 0;
        for (const item of toLookup) {
            ++processed;
            progress?.advance();
            try {
                const proposal = await buildProposal(
                    translators,
                    item.group,
                    item.searchQuery,
                    client,
                    propertyIds,
                    groups,
                    coEntityNames,
                    namedArgs.minConfidence,
                    printer,
                );
                if (proposal) {
                    proposals.push(proposal);
                }
            } catch (e) {
                printer.writeError(
                    `  ${item.group.name}: ${getErrorMessage(e)}`,
                );
            }
            if (
                !useProgressBar &&
                (processed === toLookup.length || processed % 10 === 0)
            ) {
                printer.writeLine(
                    `  ...looked up ${processed}/${toLookup.length}`,
                );
            }
        }
        progress?.complete();

        if (proposals.length === 0) {
            printer.writeLine("No augmentations proposed.");
            return;
        }

        for (const proposal of proposals) {
            writeProposal(printer, proposal);
        }

        if (!namedArgs.apply) {
            printer.writeLine();
            printer.writeLineInColor(
                chalk.gray,
                "Preview only. Re-run with --apply to write these to the conversation.",
            );
            return;
        }

        applyProposals(conversation, proposals, namedArgs.linkRelated);

        if (namedArgs.deprecate) {
            await deprecatePass(translators, conversation, proposals, printer);
        }

        printer.writeLineInColor(
            chalk.green,
            `Applied ${proposals.length} augmentation(s).`,
        );

        if (namedArgs.save) {
            await saveConversation(
                conversation,
                String(namedArgs.save),
                printer,
            );
        } else {
            printer.writeLineInColor(
                chalk.gray,
                "Changes are in memory only. Use --save <path> or @kpPodcastSave to persist.",
            );
        }
    }
}

function createDreamTranslators(
    model: TypeChatLanguageModel,
): DreamTranslators {
    const schema = loadSchema(["dreamSchema.ts"], import.meta.url);
    return {
        gate: makeTranslator<DreamGateResponse>(
            model,
            schema,
            "DreamGateResponse",
        ),
        match: makeTranslator<DreamMatchResponse>(
            model,
            schema,
            "DreamMatchResponse",
        ),
        deprecation: makeTranslator<DreamDeprecationResponse>(
            model,
            schema,
            "DreamDeprecationResponse",
        ),
    };
}

function makeTranslator<T extends object>(
    model: TypeChatLanguageModel,
    schema: string,
    typeName: string,
): TypeChatJsonTranslator<T> {
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);
    translator.createRequestPrompt = (request: string) =>
        `You are a service that translates requests into JSON objects of type "${typeName}" according to the following TypeScript definitions:\n` +
        `\`\`\`\n${schema}\`\`\`\n` +
        `The following is the request:\n` +
        `"""\n${request}\n"""\n` +
        `The following is the request translated into a single JSON object with 2 spaces of indentation and no properties with the value undefined:\n`;
    return translator;
}

function collectEntityGroups(
    conversation: kp.IConversation,
): Map<string, EntityGroup> {
    const groups = new Map<string, EntityGroup>();
    if (!conversation.semanticRefs) {
        return groups;
    }
    const entityRefs = kp.filterCollection(
        conversation.semanticRefs,
        (sr) => sr.knowledgeType === "entity",
    );
    for (const ref of entityRefs) {
        const entity = ref.knowledge as kpLib.ConcreteEntity;
        if (!entity || !entity.name) {
            continue;
        }
        const key = entity.name.trim().toLowerCase();
        if (key.length === 0) {
            continue;
        }
        let group = groups.get(key);
        if (!group) {
            group = {
                name: entity.name,
                key,
                ordinals: [],
                entities: [],
                types: new Set<string>(),
                facetKeys: new Set<string>(),
                existingFacets: [],
                count: 0,
            };
            groups.set(key, group);
        }
        group.ordinals.push(ref.semanticRefOrdinal);
        group.entities.push(entity);
        group.count++;
        if (entity.type) {
            for (const t of entity.type) {
                group.types.add(t.toLowerCase());
            }
        }
        if (entity.facets) {
            for (const facet of entity.facets) {
                const fk = `${facet.name.toLowerCase()}=${facetValueToString(
                    facet,
                ).toLowerCase()}`;
                if (!group.facetKeys.has(fk)) {
                    group.facetKeys.add(fk);
                    group.existingFacets.push(facet);
                }
            }
        }
    }
    return groups;
}

function topCoEntityNames(groups: Map<string, EntityGroup>): string[] {
    return [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, MaxCoEntities)
        .map((g) => g.name);
}

async function gateEntities(
    translators: DreamTranslators,
    groups: EntityGroup[],
    maxEntities: number,
    printer: KnowProPrinter,
): Promise<{ group: EntityGroup; searchQuery: string }[]> {
    const candidates = groups.slice(0, MaxGateEntities);
    const selected: { group: EntityGroup; searchQuery: string }[] = [];
    for (
        let start = 0;
        start < candidates.length && selected.length < maxEntities;
        start += GateBatchSize
    ) {
        const batch = candidates.slice(start, start + GateBatchSize);
        const result = await translators.gate.translate(
            buildGateRequest(batch),
        );
        if (!result.success) {
            // On a parse failure, don't silently drop the batch: include its
            // entities so they still get a chance at augmentation.
            printer.writeError(
                `Gate batch [${start}..${start + batch.length}) failed: ${result.message}. Including this batch directly.`,
            );
            for (const g of batch) {
                selected.push({ group: g, searchQuery: g.name });
                if (selected.length >= maxEntities) {
                    break;
                }
            }
            continue;
        }
        const byKey = new Map(batch.map((g) => [g.key, g]));
        for (const decision of result.data.decisions) {
            if (!decision.shouldLookup) {
                continue;
            }
            const group = byKey.get(decision.name.trim().toLowerCase());
            if (!group) {
                continue;
            }
            selected.push({
                group,
                searchQuery: decision.searchQuery?.trim() || group.name,
            });
            if (selected.length >= maxEntities) {
                break;
            }
        }
    }
    return selected;
}

function buildGateRequest(batch: EntityGroup[]): string {
    const lines = batch
        .map((g) => {
            const types = [...g.types].slice(0, 6).join(", ");
            return `- ${g.name}${types ? ` (types: ${types})` : ""}`;
        })
        .join("\n");
    return (
        `For each entity extracted from a conversation, decide whether looking it up ` +
        `in Wikidata would add useful real-world facts (types, facets such as employer ` +
        `or role, and links). Set shouldLookup=false for generic concepts, common ` +
        `objects, roles without a specific referent, pronouns, or vague references; set ` +
        `shouldLookup=true for real, identifiable people, organizations, creative works, ` +
        `places, or notable products. Return one decision per entity, using the exact ` +
        `name given.\nEntities:\n${lines}`
    );
}

async function buildProposal(
    translators: DreamTranslators,
    group: EntityGroup,
    searchQuery: string,
    client: WikidataClient,
    propertyIds: string[],
    groups: Map<string, EntityGroup>,
    coEntityNames: string[],
    minConfidence: number,
    printer: KnowProPrinter,
): Promise<DreamProposal | undefined> {
    const found = await client.searchEntities(searchQuery);
    if (found.length === 0) {
        printer.writeLineInColor(
            chalk.yellow,
            `  ${group.name}: no Wikidata match.`,
        );
        return undefined;
    }

    let chosen: WikidataCandidate | undefined;
    let confidence = 1;
    if (found.length === 1) {
        chosen = found[0];
    } else {
        const match = await disambiguate(
            translators,
            group,
            found,
            coEntityNames,
        );
        if (match && match.qid) {
            chosen = found.find((c) => c.qid === match.qid);
            confidence = match.confidence;
        }
    }
    if (!chosen) {
        printer.writeLineInColor(
            chalk.yellow,
            `  ${group.name}: no confident Wikidata match.`,
        );
        return undefined;
    }
    if (confidence < minConfidence) {
        printer.writeLineInColor(
            chalk.yellow,
            `  ${group.name}: best match ${chosen.qid} below confidence threshold (${confidence.toFixed(
                2,
            )}).`,
        );
        return undefined;
    }

    const claims = await client.getEntityClaims(chosen.qid, propertyIds);
    const augmentation = mapClaimsToAugmentation(claims, {
        types: group.types,
        facetKeys: group.facetKeys,
    });

    const links: DreamLink[] = [];
    for (const rel of augmentation.related) {
        const matched = groups.get(rel.label.trim().toLowerCase());
        if (matched && matched.key !== group.key) {
            links.push({
                group: matched,
                qid: rel.qid,
                label: rel.label,
                propertyLabel: rel.propertyLabel,
            });
        }
    }

    return {
        group,
        qid: chosen.qid,
        label: chosen.label,
        description: chosen.description,
        confidence,
        augmentation,
        links,
    };
}

async function disambiguate(
    translators: DreamTranslators,
    group: EntityGroup,
    candidates: WikidataCandidate[],
    coEntityNames: string[],
): Promise<DreamMatchResponse | undefined> {
    const types = [...group.types].slice(0, 8).join(", ") || "(none)";
    const facets = [...group.facetKeys].slice(0, 10).join("; ") || "(none)";
    const others =
        coEntityNames
            .filter((n) => n.toLowerCase() !== group.key)
            .slice(0, 20)
            .join(", ") || "(none)";
    const candLines = candidates
        .map(
            (c) =>
                `- ${c.qid}: ${c.label}${
                    c.description ? ` — ${c.description}` : ""
                }`,
        )
        .join("\n");
    const request =
        `An entity from a conversation must be matched to the correct Wikidata item.\n` +
        `Entity name: "${group.name}"\n` +
        `Known types: ${types}\n` +
        `Known facets: ${facets}\n` +
        `Other entities mentioned in the same conversation: ${others}\n` +
        `Candidates:\n${candLines}\n` +
        `Choose the QID that best matches this entity, or null if none are a confident match.`;
    const result = await translators.match.translate(request);
    return result.success ? result.data : undefined;
}

function writeProposal(printer: KnowProPrinter, p: DreamProposal): void {
    printer.writeLine();
    printer.writeHeading(p.group.name);
    printer.writeLineInColor(
        chalk.cyan,
        `  Wikidata: ${p.qid} (${p.label})${
            p.description ? ` — ${p.description}` : ""
        }  [confidence ${p.confidence.toFixed(2)}]`,
    );
    printer.writeLineInColor(chalk.gray, `  ${wikidataUrl(p.qid)}`);

    const { newTypes, newFacets } = p.augmentation;
    if (newTypes.length > 0) {
        printer.writeLineInColor(
            chalk.green,
            `  + types: ${newTypes.join(", ")}`,
        );
    }
    if (newFacets.length > 0) {
        printer.writeLineInColor(chalk.green, "  + facets:");
        for (const f of newFacets) {
            printer.writeLine(`      ${f.name} = ${facetValueToString(f)}`);
        }
    }
    if (p.links.length > 0) {
        printer.writeLineInColor(
            chalk.green,
            "  + links (related entities present in conversation):",
        );
        for (const l of p.links) {
            printer.writeLine(
                `      ${l.propertyLabel}: ${l.group.name} (${l.qid})`,
            );
        }
    }
    if (
        newTypes.length === 0 &&
        newFacets.length === 0 &&
        p.links.length === 0
    ) {
        printer.writeLineInColor(chalk.gray, "  (no new information)");
    }
}

function applyProposals(
    conversation: kp.IConversation,
    proposals: DreamProposal[],
    linkRelated: boolean,
): void {
    for (const p of proposals) {
        const provenance: kpLib.Facet[] = [
            { name: "wikidataId", value: p.qid },
            { name: "wikidataUrl", value: wikidataUrl(p.qid) },
            { name: "source", value: "wikidata" },
        ];
        const linkFacets: kpLib.Facet[] = p.links.map((l) => ({
            name: "wikidataLink",
            value: `${l.group.name} (${l.qid})`,
        }));
        const facetsToAdd = [
            ...p.augmentation.newFacets,
            ...linkFacets,
            ...provenance,
        ];

        for (let i = 0; i < p.group.entities.length; ++i) {
            const entity = p.group.entities[i];
            const ordinal = p.group.ordinals[i];
            const addedTypes = addTypes(entity, p.augmentation.newTypes);
            const addedFacets = addFacets(entity, facetsToAdd);
            indexEntityAdditions(
                conversation,
                ordinal,
                addedTypes,
                addedFacets,
            );
        }

        if (linkRelated) {
            const reciprocal: kpLib.Facet = {
                name: "wikidataLink",
                value: `${p.group.name} (${p.qid})`,
            };
            for (const l of p.links) {
                for (let i = 0; i < l.group.entities.length; ++i) {
                    const entity = l.group.entities[i];
                    const ordinal = l.group.ordinals[i];
                    const addedFacets = addFacets(entity, [reciprocal]);
                    indexEntityAdditions(
                        conversation,
                        ordinal,
                        [],
                        addedFacets,
                    );
                }
            }
        }
    }
}

function addTypes(entity: kpLib.ConcreteEntity, types: string[]): string[] {
    if (!entity.type) {
        entity.type = [];
    }
    const existing = new Set(entity.type.map((t) => t.toLowerCase()));
    const added: string[] = [];
    for (const t of types) {
        const key = t.toLowerCase();
        if (existing.has(key)) {
            continue;
        }
        existing.add(key);
        entity.type.push(t);
        added.push(t);
    }
    return added;
}

function addFacets(
    entity: kpLib.ConcreteEntity,
    facets: kpLib.Facet[],
): kpLib.Facet[] {
    entity.facets ??= [];
    const existing = new Set(
        entity.facets.map(
            (f) =>
                `${f.name.toLowerCase()}=${facetValueToString(f).toLowerCase()}`,
        ),
    );
    const added: kpLib.Facet[] = [];
    for (const f of facets) {
        const key = `${f.name.toLowerCase()}=${facetValueToString(
            f,
        ).toLowerCase()}`;
        if (existing.has(key)) {
            continue;
        }
        existing.add(key);
        entity.facets.push(f);
        added.push(f);
    }
    return added;
}

function indexEntityAdditions(
    conversation: kp.IConversation,
    ordinal: number,
    addedTypes: string[],
    addedFacets: kpLib.Facet[],
): void {
    const termIndex = conversation.semanticRefIndex;
    const propIndex = conversation.secondaryIndexes?.propertyToSemanticRefIndex;
    for (const t of addedTypes) {
        termIndex?.addTerm(t, ordinal);
        propIndex?.addProperty(kp.PropertyNames.EntityType, t, ordinal);
    }
    for (const f of addedFacets) {
        const value = facetValueToString(f);
        termIndex?.addTerm(f.name, ordinal);
        termIndex?.addTerm(value, ordinal);
        propIndex?.addProperty(kp.PropertyNames.FacetName, f.name, ordinal);
        propIndex?.addProperty(kp.PropertyNames.FacetValue, value, ordinal);
    }
}

async function deprecatePass(
    translators: DreamTranslators,
    conversation: kp.IConversation,
    proposals: DreamProposal[],
    printer: KnowProPrinter,
): Promise<void> {
    for (const p of proposals) {
        const incoming = p.augmentation.newFacets;
        if (incoming.length === 0 || p.group.existingFacets.length === 0) {
            continue;
        }
        const request = buildDeprecationRequest(
            p.group.name,
            p.group.existingFacets,
            incoming,
        );
        const result = await translators.deprecation.translate(request);
        if (!result.success) {
            printer.writeError(
                `  Deprecation pass failed for ${p.group.name}: ${result.message}`,
            );
            continue;
        }
        for (const dep of result.data.deprecations ?? []) {
            applyDeprecation(conversation, p.group, dep, printer);
        }
    }
}

function buildDeprecationRequest(
    name: string,
    existing: kpLib.Facet[],
    incoming: kpLib.Facet[],
): string {
    const existingList =
        existing
            .map((f) => `- ${f.name} = ${facetValueToString(f)}`)
            .join("\n") || "(none)";
    const incomingList =
        incoming
            .map((f) => `- ${f.name} = ${facetValueToString(f)}`)
            .join("\n") || "(none)";
    return (
        `Entity "${name}" already has these facets:\n${existingList}\n` +
        `We are adding these new facts from Wikidata:\n${incomingList}\n` +
        `Identify which EXISTING facets are now superseded or contradicted by the new ` +
        `facts (for example a single-valued attribute such as role, title, employer, or ` +
        `favorite color whose value changed). Do NOT include additive facts such as ` +
        `multiple occupations, citizenships, types, or works. Return only the existing ` +
        `facets to mark as no longer current.`
    );
}

function applyDeprecation(
    conversation: kp.IConversation,
    group: EntityGroup,
    dep: DreamDeprecation,
    printer: KnowProPrinter,
): void {
    const formerName = `former:${dep.facetName}`;
    const targetName = dep.facetName.toLowerCase();
    const targetValue = dep.oldValue.trim().toLowerCase();
    let changed = 0;
    for (let i = 0; i < group.entities.length; ++i) {
        const entity = group.entities[i];
        const ordinal = group.ordinals[i];
        if (!entity.facets) {
            continue;
        }
        for (const facet of entity.facets) {
            const fname = facet.name.toLowerCase();
            if (
                fname === targetName &&
                facetValueToString(facet).toLowerCase() === targetValue
            ) {
                facet.name = formerName;
                conversation.semanticRefIndex?.addTerm(formerName, ordinal);
                conversation.secondaryIndexes?.propertyToSemanticRefIndex?.addProperty(
                    kp.PropertyNames.FacetName,
                    formerName,
                    ordinal,
                );
                changed++;
            }
        }
    }
    if (changed > 0) {
        printer.writeLineInColor(
            chalk.magenta,
            `  deprecated ${group.name}.${dep.facetName}="${dep.oldValue}"${
                dep.newValue ? ` (now ${dep.newValue})` : ""
            }`,
        );
    }
}

async function saveConversation(
    conversation: kp.IConversation,
    filePath: string,
    printer: KnowProPrinter,
): Promise<void> {
    const writable = conversation as unknown as {
        writeToFile?: (dirPath: string, baseFileName: string) => Promise<void>;
    };
    if (typeof writable.writeToFile !== "function") {
        printer.writeError(
            "The loaded conversation does not support saving. Use the memory-specific save command (e.g. @kpPodcastSave).",
        );
        return;
    }
    const dirName = path.dirname(filePath);
    const baseName = getFileName(filePath);
    await ensureDir(dirName);
    await writable.writeToFile(dirName, baseName);
    printer.writeLineInColor(
        chalk.green,
        `Saved conversation index to ${filePath}`,
    );
}

function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value as
        | string
        | number
        | boolean
        | { amount: number | string; units: string };
    if (value !== null && typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return `${value}`;
}

function getErrorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
