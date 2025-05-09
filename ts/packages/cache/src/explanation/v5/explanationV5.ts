// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// v3 explanation schema build based on v2 to improve many-to-many mapping, fully removing the grammar concepts
// from the structure, and only using the category to classify the phrases, which makes the result more reliable
// However, the category field will need refinement. Some of the test data shows that the LLM model just emit
// "input/non-input" or something generic like "noun/verb" as the category, which is not very useful for
// generalization.

import {
    CorrectionRecord,
    ConstructionCreationConfig,
    GenericExplanationResult,
    ExplainerConfig,
} from "../genericExplainer.js";
import { Explainer } from "../explainer.js";
import {
    NonPropertySubPhrase,
    SubPhrase,
    SubPhraseExplanation,
    SubPhraseType,
} from "./subPhraseExplanationSchemaV5.js";
import {
    AlternativesExplanation,
    PropertyValue,
} from "./alternativesExplanationSchemaV5.js";
import {
    EntityProperty,
    PropertyExplanation,
} from "./propertyExplanationSchemaV5WithContext.js";
import {
    ExecutableAction,
    FullAction,
    normalizeParamString,
    RequestAction,
    toJsonActions,
} from "../requestAction.js";
import {
    Construction,
    ConstructionPart,
    WildcardMode,
} from "../../constructions/constructions.js";
import { TypeChatAgentResult, ValidationError } from "../typeChatAgent.js";
import {
    getParamSpec,
    getParamRange,
    SchemaInfoProvider,
    getNamespaceForCache,
} from "../schemaInfoProvider.js";
import { ParamSpec } from "action-schema";
import { openai } from "aiclient";
import {
    PropertyExplainer,
    createPropertyExplainer,
    isEntityParameter,
} from "./propertyExplainationV5.js";
import {
    SubPhraseExplainer,
    createSubPhraseExplainer,
    hasPropertyNames,
    isPropertySubPhrase,
} from "./subPhraseExplanationV5.js";
import {
    AlternativesExplainer,
    createAlternativesExplainer,
} from "./alternativesExplanationV5.js";
import {
    PropertyParser,
    getPropertyParser,
} from "../../constructions/propertyParser.js";
import { createParsePart } from "../../constructions/parsePart.js";
import {
    TransformInfo,
    createMatchPart,
    isMatchPart,
} from "../../constructions/matchPart.js";
import { Transforms } from "../../constructions/transforms.js";
import { getLanguageTools } from "../../utils/language.js";
import {
    createPolitenessGeneralizer,
    PolitenessGeneralizer,
} from "./politenessGeneralizationV5.js";
import { PolitenessGeneralization } from "./politenessGeneralizationSchemaV5.js";

type Explanation = PropertyExplanation &
    SubPhraseExplanation &
    AlternativesExplanation &
    Partial<PolitenessGeneralization>;

export type ExplanationResult = GenericExplanationResult<Explanation>;

// Parameter Explanation
export const form =
    "The user request is a JSON object containing a request string and the translated action";

export function requestActionToPromptString(requestAction: RequestAction) {
    return JSON.stringify(
        {
            request: requestAction.request,
            actions: toJsonActions(requestAction.actions),
        },
        undefined,
        2,
    );
}

class ExplanationV5TypeChatAgent {
    private readonly propertyExplainerWithoutContext: PropertyExplainer;
    private readonly propertyExplainerWithContext: PropertyExplainer;
    private readonly subPhrasesExplainer: SubPhraseExplainer;
    private readonly alternativesExplainer: AlternativesExplainer;
    private readonly politenessGeneralizer: PolitenessGeneralizer;
    constructor(model?: string) {
        this.propertyExplainerWithoutContext = createPropertyExplainer(
            false,
            model,
        );
        this.propertyExplainerWithContext = createPropertyExplainer(
            true,
            model,
        );
        this.subPhrasesExplainer = createSubPhraseExplainer(model);
        this.alternativesExplainer = createAlternativesExplainer(model);
        this.politenessGeneralizer = createPolitenessGeneralizer(model);
    }
    public async run(input: RequestAction, config?: ExplainerConfig) {
        const politenessGeneralizationP = this.politenessGeneralizer.run(input);

        const propertyExplainer = input.history
            ? this.propertyExplainerWithContext
            : this.propertyExplainerWithoutContext;
        const result1 = await propertyExplainer.run(input, config);
        if (!result1.success) {
            return result1;
        }
        const result2 = await this.subPhrasesExplainer.run(
            [input, result1.data],
            config,
        );
        if (result2.corrections) {
            // includes the data from agent1 in corrections
            result2.corrections.forEach((correction) => {
                correction.data = {
                    ...result1.data,
                    ...correction.data,
                };
            });
        }
        if (!result2.success) {
            return result2;
        }
        const result3 = await this.alternativesExplainer.run(
            [input, result1.data, result2.data],
            config,
        );
        if (result3.corrections) {
            // includes the data from agent1 in corrections
            result3.corrections.forEach((correction) => {
                correction.data = {
                    ...result1.data,
                    ...result2.data,
                    ...correction.data,
                };
            });
        }
        if (!result3.success) {
            return result3;
        }
        const politenessGeneralization = await politenessGeneralizationP;
        if (!politenessGeneralization.success) {
            return politenessGeneralization;
        }
        const corrections: CorrectionRecord<Partial<Explanation>>[] = [];
        if (result1.corrections) {
            corrections.push(...result1.corrections);
        }
        if (result2.corrections) {
            corrections.push(...result2.corrections);
        }
        if (result3.corrections) {
            corrections.push(...result3.corrections);
        }
        if (politenessGeneralization.corrections) {
            corrections.push(...politenessGeneralization.corrections);
        }
        const result: TypeChatAgentResult<Explanation> = {
            success: true,
            data: {
                ...result1.data,
                ...result2.data,
                ...result3.data,
                ...politenessGeneralization.data,
            },
        };
        if (corrections.length !== 0) {
            result.corrections = corrections;
        }
        return result;
    }
    public validate(
        input: RequestAction,
        result: Explanation,
        config?: ExplainerConfig,
    ): ValidationError | undefined {
        const propertyExplainer = input.history
            ? this.propertyExplainerWithContext
            : this.propertyExplainerWithoutContext;
        const result1 = propertyExplainer.validate?.(input, result, config);
        const result2 = this.subPhrasesExplainer.validate?.(
            [input, result],
            result,
            config,
        );
        const result3 = this.alternativesExplainer.validate?.(
            [input, result, result],
            result,
            config,
        );

        const corrections: string[] = [];
        if (result1) {
            corrections.push(...result1);
        }
        if (result2) {
            corrections.push(...result2);
        }
        if (result3) {
            corrections.push(...result3);
        }
        return corrections.length > 0 ? corrections : undefined;
    }
}

interface ParameterVariation {
    phrase: string;
    value: string;
}
interface ParameterVariationResult {
    originalParameterPhrase: string;
    originalParameterValue: string;
    variations: ParameterVariation[];
}

function getPropertyInfo(
    propertyName: string,
    actions: ExecutableAction[],
): {
    action: FullAction;
    parameterName?: string;
    actionIndex: number | undefined;
} {
    const parts = propertyName.split(".");
    let firstPart = parts.shift();
    if (firstPart === undefined) {
        throw new Error(`Invalid property name '${propertyName}'`);
    }

    let action: FullAction | undefined;
    let actionIndex: number | undefined;
    if (actions.length > 1) {
        // Multiple actions
        actionIndex = parseInt(firstPart);
        if (!isNaN(actionIndex) && actionIndex.toString() === firstPart) {
            action = actions[actionIndex].action;
        }
        if (action === undefined) {
            throw new Error(
                `Invalid index '${firstPart}' in property name '${propertyName}'`,
            );
        }
        firstPart = parts.shift();
    } else {
        action = actions[0].action;
    }
    if (firstPart === "fullActionName" && parts.length === 0) {
        return { action, actionIndex };
    }
    if (firstPart !== "parameters" || parts.length === 0) {
        throw new Error(`Invalid property name '${propertyName}'`);
    }
    return { action, parameterName: parts.join("."), actionIndex };
}

function getPropertySpec(
    propertyName: string,
    actions: ExecutableAction[],
    schemaInfoProvider?: SchemaInfoProvider,
): ParamSpec | undefined {
    const { action, parameterName } = getPropertyInfo(propertyName, actions);
    if (parameterName === undefined) {
        // fullActionName
        return "literal";
    }
    return getParamSpec(action, parameterName, schemaInfoProvider);
}

function getPropertyTransformInfo(
    propertyName: string,
    actions: ExecutableAction[],
    schemaInfoProvider?: SchemaInfoProvider,
): TransformInfo {
    const { action, parameterName, actionIndex } = getPropertyInfo(
        propertyName,
        actions,
    );
    const schemaName = action.schemaName;
    if (schemaName === undefined) {
        throw new Error("Action without translator name");
    }
    const namespace = parameterName
        ? getNamespaceForCache(
              schemaName,
              action.actionName,
              schemaInfoProvider,
          )
        : // Since constructions translated to a specific schema based on the actionName, we should not merge different actions.
          // Add the actionName to the namespace
          // TODO: consider to improve this for cases where different actions have the same parameters schema.
          `${schemaName}.${action.actionName}`;

    const transformName = parameterName
        ? `parameters.${parameterName}`
        : "fullActionName";
    return { namespace, transformName, actionIndex };
}

async function augmentExplanation(
    explanation: Explanation,
    requestAction: RequestAction,
    constructionCreationConfig: ConstructionCreationConfig,
) {
    // for each non-implicit parameter that matches a type in the schema config, generate all of the alternatives for that parameter

    const schemaInfoProvider = constructionCreationConfig.schemaInfoProvider;
    const actions = requestAction.actions;

    for (const param of explanation.propertyAlternatives) {
        // If we are handling it with a parser already, then no need to augment it.
        if (getParserForPropertyValue(param, actions, schemaInfoProvider)) {
            // REVIEW: we don't use the parser if the subphrase for the property is used for multiple properties.
            // Should we continue augment those?
            continue;
        }
        const paramSpec = getPropertySpec(
            param.propertyName,
            actions,
            schemaInfoProvider,
        );
        if (paramSpec) {
            const paramRange = getParamRange(paramSpec);
            if (paramRange) {
                const subPhrases = param.propertySubPhrases;
                if (subPhrases.length === 1) {
                    const model = openai.createChatModel(
                        undefined,
                        {
                            response_format: { type: "json_object" },
                        },
                        undefined,
                        ["explanationV5"],
                    );
                    const subPhrase = subPhrases[0];
                    const prompt = `You are a service that translates user requests into JSON objects of type "ParameterVariationResult" according to the following TypeScript definitions:
interface ParameterVariation {
phrase: string;
value: string;
} 
interface ParameterVariationResult {
originalParameterPhrase: string;
originalParameterValue: string;    
variations: ParameterVariation[];
}
For every value V that is within the range of ${paramRange.min} to ${paramRange.max} by step ${paramRange.step}, generate a phrase P that only changes the phrase '${subPhrase}' enough to change the value to V.
Emit the generated phrases and values as a JSON object of type ParameterVariationResult with 2 spaces of indentation and no properties with the value undefined:
`;
                    const result = await model.complete(prompt);
                    if (result.success) {
                        const generatedAlternatives = JSON.parse(
                            result.data,
                        ) as ParameterVariationResult;
                        const additionalEntries =
                            generatedAlternatives.variations.map((v) => ({
                                propertySubPhrases: [v.phrase],
                                propertyValue: paramRange.convertToInt
                                    ? parseInt(v.value)
                                    : v.value,
                            }));
                        param.alternatives.push(...additionalEntries);
                    }
                }
            }
        }
    }
}

export function createExplainerV5(model?: string) {
    const agent = new ExplanationV5TypeChatAgent(model);
    return new Explainer(
        agent,
        createConstructionV5,
        toPrettyString,
        augmentExplanation,
    );
}

export type ExplanationV5 = Explanation;

function collectAltParamMatches(
    matches: string[],
    phrase: SubPhrase,
    paramInfo: PropertyValue,
) {
    const index = paramInfo.propertySubPhrases.indexOf(phrase.text);
    if (index === -1) {
        // This shouldn't happen validate should have caught this
        throw new Error(
            `Property sub-phrase '${phrase.text}' not found in property '${paramInfo.propertyName}'`,
        );
    }
    if (paramInfo.alternatives !== undefined) {
        paramInfo.alternatives.forEach((alt) => {
            if (alt.propertySubPhrases.some((s) => s === "")) {
                // REVIEW: can't handle alternatives that have some of the sub-phrases as empty string
                return;
            }
            if (alt.propertySubPhrases.length < index) {
                // This shouldn't happen validate should have caught this
                throw new Error(
                    `Alternate sub-phrase for '${paramInfo.propertyName} not found at index ${index}'`,
                );
            }
            matches.push(alt.propertySubPhrases[index]);
        });
    }
}

function getParserForPropertyValue(
    propertyValue: PropertyValue,
    actions: ExecutableAction[],
    schemaInfoProvider?: SchemaInfoProvider,
) {
    if (propertyValue.propertySubPhrases.length !== 1) {
        return undefined;
    }

    const paramSpec = getPropertySpec(
        propertyValue.propertyName,
        actions,
        schemaInfoProvider,
    );
    if (paramSpec === undefined) {
        return undefined;
    }

    const parser = getPropertyParser(paramSpec);
    if (
        parser === undefined ||
        typeof propertyValue.propertyValue !== parser.valueType
    ) {
        return undefined;
    }

    parser.regExp.lastIndex = 0;
    const subphrase = propertyValue.propertySubPhrases[0];
    return parser.regExp.test(subphrase) &&
        parser.convertToValue(subphrase) === propertyValue.propertyValue
        ? parser
        : undefined;
}

const langTool = getLanguageTools("en");
function canBeMergedNonPropertySubPhrase(phrase: NonPropertySubPhrase) {
    return langTool?.hasClosedClass(phrase.text, phrase.isOptional) !== true;
}

function useSynonymsForNonPropertySubPhrase(phrase: NonPropertySubPhrase) {
    return langTool?.hasClosedClass(phrase.text, phrase.isOptional) !== true;
}

function addPolitePrefixParts(
    parts: ConstructionPart[],
    explanation: Explanation,
) {
    if (
        explanation.politePrefixes === undefined ||
        explanation.politeSuffixes === undefined
    ) {
        return;
    }

    let hasPolitePrefix = false;
    let hasPoliteSuffix = false;
    let seenNonOptional = false;
    for (const part of parts) {
        if (!part.optional) {
            hasPoliteSuffix = false;
            seenNonOptional = true;
        } else if (isMatchPart(part) && part.matchSet.name === "politeness") {
            if (!seenNonOptional) {
                hasPolitePrefix = true;
            } else {
                hasPoliteSuffix = true;
            }
        }
    }

    if (!hasPolitePrefix && explanation.politePrefixes.length !== 0) {
        parts.unshift(
            createMatchPart(explanation.politePrefixes, "politeness", {
                optional: true,
            }),
        );
    }

    if (!hasPoliteSuffix && explanation.politeSuffixes.length !== 0) {
        parts.push(
            createMatchPart(explanation.politeSuffixes, "politeness", {
                optional: true,
            }),
        );
    }
}

export function createConstructionV5(
    requestAction: RequestAction,
    explanation: Explanation,
    constructionCreationConfig: ConstructionCreationConfig,
) {
    const actions = requestAction.actions;
    const schemaInfoProvider = constructionCreationConfig.schemaInfoProvider;
    const entityParameters = explanation.properties.filter(
        (param) => isEntityParameter(param) && param.entityIndex !== undefined,
    ) as EntityProperty[];
    const entityParamMap = new Map(
        entityParameters.map((param) => [param.name, param.entityIndex]),
    );

    // Collect the subphrases that we will ignore synonyms for.
    const disableSynonymsSubPhrases = new Set<SubPhrase>();
    // Collect the property names that we will ignore alternates for.
    const disableAlternateParamValues = new Set<string>();

    for (const phrase of explanation.subPhrases) {
        if (!hasPropertyNames(phrase)) {
            if (!useSynonymsForNonPropertySubPhrase(phrase)) {
                disableSynonymsSubPhrases.add(phrase);
            }
            continue;
        }

        // Disable parameter alternatives
        // Don't use alternatives if the type of the field is a set of string literals
        if (
            phrase.propertyNames.some(
                (propertyName) =>
                    getPropertySpec(
                        propertyName,
                        actions,
                        schemaInfoProvider,
                    ) === "literal",
            )
        ) {
            phrase.propertyNames.forEach((propertyName) =>
                disableAlternateParamValues.add(propertyName),
            );
        }
    }

    const transformNamespaces = new Map<string, Transforms>();

    const getTransforms = (namespace: string) => {
        let transforms = transformNamespaces.get(namespace);
        if (transforms === undefined) {
            transforms = new Transforms();
            transformNamespaces.set(namespace, transforms);
        }
        return transforms;
    };

    const propertyParserMap = new Map<string, PropertyParser>();

    // Add the transforms for properties
    const propertyMap = new Map<string, PropertyValue>();
    const explicitPropertyNames = new Set<string>();
    for (const param of explanation.propertyAlternatives) {
        // property alternatives are all explicit properties
        const propertyName = param.propertyName;
        explicitPropertyNames.add(propertyName);

        // If the property has a parser, use it.
        const propertyParser = getParserForPropertyValue(
            param,
            actions,
            schemaInfoProvider,
        );
        if (propertyParser !== undefined) {
            propertyParserMap.set(propertyName, propertyParser);
            continue;
        }

        // Add the transforms for the property
        const transformInfo = getPropertyTransformInfo(
            propertyName,
            actions,
            schemaInfoProvider,
        );
        const transforms = getTransforms(transformInfo.namespace);
        const entityIndex = entityParamMap.get(param.propertyName);
        if (entityIndex !== undefined) {
            if (requestAction.history === undefined) {
                throw new Error("Entity parameter without history context");
            }
            transforms.addEntity(
                transformInfo.transformName,
                param.propertySubPhrases.join("|"),
                requestAction.history.entities[entityIndex].type,
            );

            // TODO: Don't use other synonyms or alternatives info for entities for now
            continue;
        }

        // For use later to on getting sub-phrase alternatives
        propertyMap.set(param.propertyName, param);

        transforms.add(
            transformInfo.transformName,
            param.propertySubPhrases.join("|"),
            param.propertyValue,
            true,
        );

        // We can't use alternate string if the parameter has subphrase that is also used by actionName
        if (!disableAlternateParamValues.has(param.propertyName)) {
            param.alternatives.forEach((alt) => {
                if (alt.propertySubPhrases.some((s) => s === "")) {
                    // REVIEW: can't handle alternatives that have some of the sub-phrases as empty string
                    return;
                }
                transforms.add(
                    transformInfo.transformName,
                    alt.propertySubPhrases.join("|"),
                    alt.propertyValue,
                    false,
                );
            });
        }
    }

    // We can only do wildcard if all the parameters that this sub-phrase maps to are wildcard in the schema config
    // and they are direct copy of the text value.
    const shouldValueBeCopied = (
        phrase: SubPhrase,
        paramInfo: PropertyValue,
    ) => {
        const ltext = normalizeParamString(phrase.text);
        const lval = normalizeParamString(paramInfo.propertyValue.toString());
        return (
            // Only handle direct copy of the text to value
            ltext === lval ||
            // REVIEW: a hack to ignore quote mismatch
            ltext === `'${lval}'` ||
            ltext === `"${lval}"`
        );
    };

    const updateWildcardMode = (
        wildcardMode: WildcardMode,
        phrase: SubPhrase,
        paramInfo: PropertyValue,
    ) => {
        if (
            wildcardMode === WildcardMode.Disabled ||
            !shouldValueBeCopied(phrase, paramInfo)
        ) {
            return WildcardMode.Disabled;
        }
        const spec = getPropertySpec(
            paramInfo.propertyName,
            actions,
            schemaInfoProvider,
        );
        return spec === "wildcard"
            ? WildcardMode.Enabled
            : spec === "checked_wildcard"
              ? wildcardMode
              : WildcardMode.Disabled;
    };

    const parts = explanation.subPhrases.map((phrase) => {
        try {
            const matches = [phrase.text];
            if (!isPropertySubPhrase(phrase)) {
                if (useSynonymsForNonPropertySubPhrase(phrase)) {
                    matches.push(...phrase.synonyms.filter((s) => s !== ""));
                }
                return createMatchPart(matches, phrase.category, {
                    optional: !!phrase.isOptional,
                    canBeMerged: canBeMergedNonPropertySubPhrase(phrase),
                });
            }

            // Process property sub-phrases
            const hasSinglePropertyName = phrase.propertyNames.length === 1;
            if (hasSinglePropertyName) {
                const propertyName = phrase.propertyNames[0];
                const parser = propertyParserMap.get(propertyName);
                if (parser !== undefined) {
                    return createParsePart(propertyName, parser);
                }
            }
            let wildcardMode = WildcardMode.Checked;

            // REVIEW: can the match set be merged if it is for multiple param names?
            let canBeMerged = hasSinglePropertyName;
            const transformInfos: TransformInfo[] = [];
            // Get the parameter info that this phase maps to
            for (const propertyName of phrase.propertyNames) {
                const transformInfo = getPropertyTransformInfo(
                    propertyName,
                    actions,
                    schemaInfoProvider,
                );
                transformInfos.push(transformInfo);
                if (entityParamMap.has(propertyName)) {
                    wildcardMode = WildcardMode.Disabled; // not a wildcard mapping
                    canBeMerged = false; // REVIEW: can you merge matchset for entity references?

                    // REVIEW: Don't use other synonyms or alternatives info for entities for now
                    continue;
                }

                const paramInfo = propertyMap.get(propertyName);
                if (paramInfo === undefined) {
                    // This shouldn't happen validate should have caught this
                    throw new Error(`Parameter ${propertyName} not found`);
                }

                wildcardMode = updateWildcardMode(
                    wildcardMode,
                    phrase,
                    paramInfo,
                );

                if (!disableAlternateParamValues.has(propertyName)) {
                    collectAltParamMatches(matches, phrase, paramInfo);
                }
            }

            const baseName = `M:${phrase.category}`;
            return createMatchPart(matches, baseName, {
                transformInfos,
                canBeMerged,
                wildcardMode,
            });
        } catch (e: any) {
            throw new Error(
                `Exception while processing the phrase '${phrase.text}': ${e.message}`,
            );
        }
    });

    const implicitProperties = explanation.properties.filter(
        (param) => !explicitPropertyNames.has(param.name),
    );

    addPolitePrefixParts(parts, explanation);

    return Construction.create(
        parts,
        transformNamespaces,
        getEmptyArrayPropertyNames(toJsonActions(actions)),
        implicitProperties.map((e) => {
            return {
                paramName: e.name,
                paramValue: e.value,
            };
        }),
    );
}

function getEmptyArrayPropertyNames(obj: any): string[] | undefined {
    const names: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "object") {
            if (Array.isArray(value) && value.length === 0) {
                names.push(key);
            } else {
                const children = getEmptyArrayPropertyNames(value);
                if (children !== undefined) {
                    for (const child of children) {
                        names.push(`${key}.${child}`);
                    }
                }
            }
        }
    }
    return names.length > 0 ? names : undefined;
}

function toPrettyString(explanation: Explanation) {
    const categoryStr = (phrase: SubPhraseType) => {
        return hasPropertyNames(phrase)
            ? `<M:${phrase.category}>`
            : `<${phrase.category}>${phrase.isOptional ? "?" : ""}`;
    };
    const categories = explanation.subPhrases.map((phrase, i) => {
        return categoryStr(phrase);
    });

    const widths = explanation.subPhrases.map((phrase) =>
        Math.max(
            phrase.text.length,
            phrase.category.length + 2,
            ...(isPropertySubPhrase(phrase)
                ? []
                : phrase.synonyms.map((s) => s.length)),
            ...categories.map((c) => c.length),
        ),
    );

    const nameWidths = 10;
    const createLine = (name: string, entries: string[]) => {
        return `${name.padStart(nameWidths)} | ${entries
            .map((e, i) => e.padEnd(widths[i]))
            .join(" | ")} |`;
    };
    const horizontalLine = createLine(
        "",
        widths.map((w) => "-".repeat(w)),
    );

    const lines: string[] = [];
    // Category
    lines.push(createLine("Category", categories));
    lines.push(horizontalLine);

    // Original
    lines.push(
        createLine(
            "Original",
            explanation.subPhrases.map((phrase) => phrase.text),
        ),
    );
    lines.push(horizontalLine);

    // Synonyms
    const maxSynonyms = Math.max(
        ...explanation.subPhrases.map((phrase) =>
            isPropertySubPhrase(phrase) ? 0 : phrase.synonyms.length,
        ),
    );

    for (let i = 0; i < maxSynonyms; i++) {
        lines.push(
            createLine(
                i === 0 ? "Synonyms" : "",
                explanation.subPhrases.map((phrase) =>
                    isPropertySubPhrase(phrase)
                        ? ""
                        : (phrase.synonyms[i] ?? ""),
                ),
            ),
        );
    }
    return lines.join("\n");
}
