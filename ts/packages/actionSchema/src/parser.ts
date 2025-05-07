// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaTypeAliasDefinition,
    SchemaTypeInterfaceDefinition,
    SchemaTypeObject,
    SchemaObjectFields,
    SchemaTypeStringUnion,
    SchemaType,
    SchemaTypeReference,
    SchemaTypeUnion,
    SchemaTypeDefinition,
    ActionSchemaTypeDefinition,
    SchemaObjectField,
    ParsedActionSchema,
    SchemaEntryTypeDefinitions,
    ActionSchemaEntryTypeDefinitions,
} from "./type.js";
import ts from "typescript";
import { ActionParamSpecs, SchemaConfig } from "./schemaConfig.js";
import { resolveReference } from "./utils.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:schema:parse");

function checkParamSpecs(
    paramSpecs: ActionParamSpecs,
    parameterType: SchemaTypeObject<SchemaObjectFields>,
    actionName: string,
) {
    for (const [propertyName, spec] of Object.entries(paramSpecs)) {
        const properties = propertyName.split(".");
        let currentType: SchemaType = parameterType;
        for (const name of properties) {
            if (
                name === "__proto__" ||
                name === "constructor" ||
                name === "prototype"
            ) {
                throw new Error(
                    `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': Illegal parameter property name '${name}'`,
                );
            }
            const maybeIndex = parseInt(name);
            if (maybeIndex.toString() === name) {
                throw new Error(
                    `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': paramSpec cannot be applied to specific array index ${maybeIndex}`,
                );
            }
            if (name === "*") {
                if (currentType.type !== "array") {
                    throw new Error(
                        `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': '*' is only allowed for array types`,
                    );
                }
                currentType = currentType.elementType;
            } else {
                if (currentType.type !== "object") {
                    throw new Error(
                        `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': Access property '${name}' of non-object`,
                    );
                }

                const field: SchemaObjectField | undefined =
                    currentType.fields[name];
                if (field === undefined) {
                    throw new Error(
                        `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': property '${name}' does not exist`,
                    );
                }
                currentType = field.type;
            }
            const resolvedType = resolveReference(currentType);
            if (resolvedType === undefined) {
                throw new Error(
                    `Schema Config Error: Invalid parameter name '${propertyName}' for action '${actionName}': unresolved type reference for property '${name}'`,
                );
            }
            currentType = resolvedType;
        }
        switch (spec) {
            case "wildcard":
            case "checked_wildcard":
            case "time":
                if (currentType.type !== "string") {
                    throw new Error(
                        `Schema Config Error: Parameter '${propertyName}' for action '${actionName}' has invalid type '${currentType.type}' for paramSpec '${spec}'. `,
                    );
                }
                break;
            case "literal":
                if (
                    currentType.type !== "string" &&
                    currentType.type !== "string-union"
                ) {
                    throw new Error(
                        `Schema Config Error: Parameter '${propertyName}' for action '${actionName}' has invalid type '${currentType.type}' for paramSpec '${spec}'. `,
                    );
                }
                break;
            case "number":
            case "percentage":
            case "ordinal":
                if (currentType.type !== "number") {
                    throw new Error(
                        `Schema Config Error: Parameter '${propertyName}' for action '${actionName}' has invalid type '${currentType.type}' for paramSpec '${spec}'. `,
                    );
                }
                break;
            default:
                throw new Error(
                    `Schema Config Error: Parameter '${propertyName}' for action '${actionName}' has unknown paramSpec '${spec}'. `,
                );
        }
    }
}

function checkActionSchema(
    definition: SchemaTypeDefinition,
    schemaConfig: SchemaConfig | undefined,
): [string, ActionSchemaTypeDefinition] {
    const name = definition.name;

    if (definition.type.type !== "object") {
        throw new Error(
            `Schema Error: object type expect in action schema type ${name}, got ${definition.type.type}`,
        );
    }

    const { actionName, parameters } = definition.type.fields;
    if (actionName === undefined) {
        throw new Error(
            `Schema Error: Missing actionName field in action schema type ${name}`,
        );
    }
    if (actionName.optional) {
        throw new Error(
            `Schema Error: actionName field must be required in action schema type ${name}`,
        );
    }
    if (
        actionName.type.type !== "string-union" ||
        actionName.type.typeEnum.length !== 1
    ) {
        throw new Error(
            `Schema Error: actionName field must be a string literal in action schema type ${name}`,
        );
    }

    const actionNameString = actionName.type.typeEnum[0];
    const parameterFieldType = resolveReference(parameters?.type);
    if (
        parameterFieldType !== undefined &&
        parameterFieldType.type !== "object"
    ) {
        throw new Error(
            `Schema Error: parameters field must be an object in action schema type ${name}`,
        );
    }

    const actionDefinition = definition as ActionSchemaTypeDefinition;

    const paramSpecs = schemaConfig?.paramSpec?.[actionNameString];
    if (paramSpecs !== undefined) {
        if (paramSpecs !== false) {
            checkParamSpecs(paramSpecs, parameterFieldType!, actionNameString);
        }
        actionDefinition.paramSpecs = paramSpecs;
    }
    return [actionNameString, actionDefinition];
}

export function createParsedActionSchema(
    entry: SchemaEntryTypeDefinitions,
    order: Map<string, number> | undefined,
    strict: boolean,
    schemaConfig?: SchemaConfig,
): ParsedActionSchema {
    const pending: SchemaTypeDefinition[] = [];
    if (entry.action) {
        if (strict && !entry.action.exported) {
            throw new Error(
                `Schema Error: Action entry type '${entry.action.name}' must be exported`,
            );
        }
        pending.push(entry.action);
    }
    if (entry.activity) {
        if (strict && !entry.activity.exported) {
            throw new Error(
                `Schema Error: Activity entry type '${entry.activity.name}' must be exported`,
            );
        }
        pending.push(entry.activity);
    }
    const actionSchemas = new Map<string, ActionSchemaTypeDefinition>();
    while (pending.length > 0) {
        const current = pending.shift()!;
        switch (current.type.type) {
            case "object":
                const [actionName, actionSchema] = checkActionSchema(
                    current,
                    schemaConfig,
                );
                if (actionSchemas.get(actionName)) {
                    throw new Error(
                        `Schema Error: Duplicate action name '${actionName}'`,
                    );
                }
                actionSchemas.set(actionName, actionSchema);
                break;
            case "type-union":
                if (strict && current.comments) {
                    throw new Error(
                        `Schema Error: entry type comments for '${current.name}' are not used for prompts. Remove from the action schema file.\n${current.comments.map((s) => `  - ${s}`).join("\n")}`,
                    );
                }
                for (const t of current.type.types) {
                    if (t.type !== "type-reference") {
                        throw new Error(
                            `Schema Error: expected type reference in the entry type union`,
                        );
                    }
                    if (t.definition === undefined) {
                        throw new Error(
                            `Schema Error: unresolved type reference '${t.name}' in the entry type union`,
                        );
                    }
                    pending.push(t.definition);
                }
                break;
            case "type-reference":
                // Definition that references another type is the same as a union type with a single type.
                if (strict && current.comments) {
                    throw new Error(
                        `Schema Error: entry type comments for '${current.name}' are not used for prompts. Remove from the action schema file.\n${current.comments.map((s) => `  - ${s}`).join("\n")}`,
                    );
                }
                if (current.type.definition === undefined) {
                    throw new Error(
                        `Schema Error: unresolved type reference '${current.type.name}' in the entry type union`,
                    );
                }
                pending.push(current.type.definition);
                break;
            default:
                throw new Error(
                    `Schema Error: invalid type '${current.type.type}' in action schema type ${current.name}`,
                );
        }
    }
    if (actionSchemas.size === 0) {
        throw new Error("No action schema found");
    }
    const parsedActionSchema: ParsedActionSchema = {
        entry: entry as ActionSchemaEntryTypeDefinitions,
        actionSchemas,
    };
    if (schemaConfig?.actionNamespace === true) {
        parsedActionSchema.actionNamespace = true;
    }
    if (order) {
        parsedActionSchema.order = order;
    }
    return parsedActionSchema;
}

type SchemaTypeNames = {
    action?: string;
    activity?: string;
};

export function parseActionSchemaSource(
    source: string,
    schemaName: string,
    typeName: string | SchemaTypeNames,
    fileName: string = "",
    schemaConfig?: SchemaConfig,
    strict: boolean = false,
): ParsedActionSchema {
    debug(`Parsing ${schemaName} for ${JSON.stringify(typeName)}: ${fileName}`);
    try {
        const sourceFile = ts.createSourceFile(
            fileName,
            source,
            ts.ScriptTarget.ES5,
        );
        const parsed = ActionParser.parseSourceFile(
            sourceFile,
            typeName,
            schemaConfig,
            strict,
        );
        debug(`Parse Successful ${schemaName}`);
        return parsed;
    } catch (e: any) {
        throw new Error(`Error parsing schema '${schemaName}': ${e.message}`);
    }
}

class ActionParser {
    static parseSourceFile(
        sourceFile: ts.SourceFile,
        schemaType: string | SchemaTypeNames,
        schemaConfig: SchemaConfig | undefined,
        strict: boolean,
    ) {
        const parser = new ActionParser();
        const definition = parser.parseSchema(sourceFile, schemaType);
        const result = createParsedActionSchema(
            definition,
            parser.typeOrder,
            strict,
            schemaConfig,
        );
        return result;
    }
    private constructor() {}
    private parseSchema(
        sourceFile: ts.SourceFile,
        typeName: string | SchemaTypeNames,
    ): SchemaEntryTypeDefinitions {
        this.fullText = sourceFile.getFullText();
        ts.forEachChild(sourceFile, (node: ts.Node) => {
            this.parseAST(node);
        });

        for (const pending of this.pendingReferences) {
            const resolvedType = this.typeMap.get(pending.name);
            if (resolvedType === undefined) {
                throw new Error(`Type '${pending.name}' not found`);
            }
            pending.definition = resolvedType;
        }

        const definitions: SchemaEntryTypeDefinitions = {};
        const actionTypeName =
            typeof typeName === "string" ? typeName : typeName.action;
        if (actionTypeName) {
            definitions.action = this.typeMap.get(actionTypeName);
            if (definitions.action === undefined) {
                throw new Error(`Action type '${actionTypeName}' not found`);
            }
        }

        const activityTypeName =
            typeof typeName === "string" ? undefined : typeName.activity;
        if (activityTypeName) {
            definitions.activity = this.typeMap.get(activityTypeName);
            if (definitions.activity === undefined) {
                throw new Error(
                    `Activity type '${activityTypeName}' not found`,
                );
            }
        }
        return definitions;
    }

    private fullText = "";
    private typeMap = new Map<string, SchemaTypeDefinition>();
    private typeOrder = new Map<string, number>();
    private pendingReferences: SchemaTypeReference[] = [];
    private parseAST(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.TypeAliasDeclaration:
                this.parseTypeAliasDeclaration(node as ts.TypeAliasDeclaration);
                break;
            case ts.SyntaxKind.InterfaceDeclaration:
                this.parseInterfaceDeclaration(node as ts.InterfaceDeclaration);
                break;
            case ts.SyntaxKind.EndOfFileToken:
            case ts.SyntaxKind.EmptyStatement:
                break;
            default:
                throw new Error(
                    `Unhandled node type ${ts.SyntaxKind[node.kind]}`,
                );
        }
    }

    private isExported(modifiers?: ts.NodeArray<ts.ModifierLike>): boolean {
        let exported = false;
        if (modifiers !== undefined && modifiers.length > 0) {
            for (const modifier of modifiers) {
                if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
                    exported = true;
                    continue; // continue to check for unsupported modifiers.
                }
                throw new Error(`Modifier are not supported ${modifier}`);
            }
        }
        return exported;
    }
    private parseTypeAliasDeclaration(node: ts.TypeAliasDeclaration): void {
        const name = node.name.text;
        try {
            if (node.typeParameters) {
                throw new Error("Generics are not supported");
            }
            const exported = this.isExported(node.modifiers);
            const type = this.parseType(node.type);
            const definition: SchemaTypeAliasDefinition = {
                alias: true,
                name,
                type,
                comments: this.getLeadingCommentStrings(node),
                exported,
            };
            this.addTypeDefinition(definition);
        } catch (e: any) {
            throw new Error(`Error parsing alias type ${name}: ${e.message}`);
        }
    }

    private parseInterfaceDeclaration(node: ts.InterfaceDeclaration): void {
        const name = node.name.text;
        try {
            if (node.typeParameters) {
                throw new Error("Generics are not supported");
            }
            if (node.heritageClauses) {
                throw new Error("Heritage clauses are not supported");
            }
            const exported = this.isExported(node.modifiers);
            const type = this.parseObjectType(node);
            const definition: SchemaTypeInterfaceDefinition = {
                alias: false,
                name,
                type,
                comments: this.getLeadingCommentStrings(node),
                exported,
                order: this.typeMap.size,
            };
            this.addTypeDefinition(definition);
        } catch (e: any) {
            throw new Error(
                `Error parsing interface type ${name}: ${e.message}`,
            );
        }
    }

    private addTypeDefinition(definition: SchemaTypeDefinition) {
        this.typeMap.set(definition.name, definition);
        this.typeOrder.set(definition.name, this.typeMap.size);
    }

    private parseType(node: ts.TypeNode): SchemaType {
        switch (node.kind) {
            case ts.SyntaxKind.StringKeyword:
                return { type: "string" };
            case ts.SyntaxKind.NumberKeyword:
                return { type: "number" };
            case ts.SyntaxKind.BooleanKeyword:
                return { type: "boolean" };
            case ts.SyntaxKind.UndefinedKeyword:
                return { type: "undefined" };
            case ts.SyntaxKind.TypeReference:
                return this.parseTypeReference(node as ts.TypeReferenceNode);
            case ts.SyntaxKind.ArrayType:
                return this.parseArrayType(node as ts.ArrayTypeNode);
            case ts.SyntaxKind.UnionType:
                return this.parseUnionType(node as ts.UnionTypeNode);
            case ts.SyntaxKind.TypeLiteral:
                return this.parseObjectType(node as ts.TypeLiteralNode);
            case ts.SyntaxKind.LiteralType:
                return this.parseLiteralType(node as ts.LiteralTypeNode);
            // TODO: Faithfully resolve intersection types
            // case ts.SyntaxKind.IntersectionType:
            //     return this.parseIntersectionType(node as ts.IntersectionTypeNode);
            default:
                throw new Error(
                    `Unhandled type node ${ts.SyntaxKind[node.kind]}`,
                );
        }
    }

    private parseTypeReference(
        node: ts.TypeReferenceNode,
    ): SchemaTypeReference {
        if (node.typeName.kind === ts.SyntaxKind.QualifiedName) {
            throw new Error("Qualified name not supported in type references");
        }
        const typeName = node.typeName.text;

        const result: SchemaTypeReference = {
            type: "type-reference",
            name: typeName,
        };
        this.pendingReferences.push(result);
        return result;
    }
    private parseArrayType(node: ts.ArrayTypeNode): SchemaType {
        const elementType = this.parseType(node.elementType);
        return {
            type: "array",
            elementType,
        };
    }

    private parseStringUnionType(
        node: ts.UnionTypeNode,
    ): SchemaTypeStringUnion {
        const typeEnum = node.types.map((type) => {
            if (
                ts.isLiteralTypeNode(type) &&
                type.literal.kind === ts.SyntaxKind.StringLiteral
            ) {
                return type.literal.text;
            }
            throw new Error(
                "Only string literal types are supported in unions",
            );
        });
        return {
            type: "string-union",
            typeEnum,
        };
    }

    private parseLiteralType(node: ts.LiteralTypeNode): SchemaTypeStringUnion {
        if (node.literal.kind !== ts.SyntaxKind.StringLiteral) {
            throw new Error("Only string literal types are supported");
        }
        return {
            type: "string-union",
            typeEnum: [node.literal.text],
        };
    }

    private parseTypeUnionType(
        node: ts.UnionTypeNode,
    ): SchemaTypeUnion | SchemaTypeStringUnion {
        const types = node.types.map((type) => this.parseType(type));
        if (types.every((type) => type.type === "string-union")) {
            return {
                type: "string-union",
                typeEnum: types
                    .map((type) => (type as SchemaTypeStringUnion).typeEnum)
                    .flat(),
            };
        }
        return {
            type: "type-union",
            types,
        };
    }

    private parseUnionType(node: ts.UnionTypeNode) {
        return node.types[0].kind === ts.SyntaxKind.StringLiteral
            ? this.parseStringUnionType(node)
            : this.parseTypeUnionType(node);
    }

    // TOOD: Faithfully resolve intersection types
    // private parseIntersectionType(node: ts.IntersectionTypeNode): SchemaTypeObject {
    //     const fields: SchemaObjectFields = {};
    //     for (const type of node.types) {
    //         const parsedType = this.parseType(type);
    //         if (parsedType.type === "object") {
    //             Object.assign(fields, parsedType.fields);
    //         } else if (parsedType.type == "type-reference") {

    //             const typeRef = this.typeMap.get(parsedType.name);

    //             if (typeRef?.type.type !== 'object') {
    //                 throw new Error(
    //                     `Unsupported type reference in intersection type: ${parsedType.name}`,
    //                 );
    //             }
    //             Object.entries(typeRef.type.fields).forEach(([key, field]) => {
    //                 fields[key] = {
    //                     type: typeRef.type,
    //                     optional: field.optional,
    //                     comments: field.comments,
    //                     trailingComments: field.trailingComments,
    //                 };
    //             });

    //         } else {
    //             throw new Error(
    //                 `Only object types are supported in intersection types. Received ${parsedType.type}`
    //             );
    //         }
    //     }
    //     return {
    //         type: "object",
    //         fields,
    //     };
    // }

    private parseObjectType(
        node: ts.TypeLiteralNode | ts.InterfaceDeclaration,
    ): SchemaTypeObject {
        const fields: SchemaObjectFields = {};
        for (const member of node.members) {
            if (ts.isPropertySignature(member)) {
                if (member.type) {
                    if (
                        member.name.kind === ts.SyntaxKind.ComputedPropertyName
                    ) {
                        throw new Error("Computed property name not supported");
                    }
                    fields[member.name.text] = {
                        type: this.parseType(member.type),
                        optional: member.questionToken !== undefined,
                        comments: this.getLeadingCommentStrings(member),
                        trailingComments:
                            this.getTrailingCommentStrings(member),
                    };
                }
            }
        }
        return {
            type: "object",
            fields,
        };
    }

    private getLeadingCommentStrings(node: ts.Node) {
        const commentRanges = ts.getLeadingCommentRanges(
            this.fullText,
            node.getFullStart(),
        );
        return this.processCommentRanges(commentRanges);
    }

    private getTrailingCommentStrings(node: ts.Node) {
        const commentRanges = ts.getTrailingCommentRanges(
            this.fullText,
            node.getEnd(),
        );
        return this.processCommentRanges(commentRanges);
    }

    private processCommentRanges(commentRanges: ts.CommentRange[] | undefined) {
        if (commentRanges === undefined) {
            return undefined;
        }
        const comments: string[] = [];
        for (const r of commentRanges) {
            if (r.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
                throw new Error("Multi-line comments are not supported");
            }

            // Strip the leading //
            const comment = this.fullText.slice(r.pos + 2, r.end);
            if (
                comment.startsWith(" Copyright (c) Microsoft Corporation") ||
                comment.startsWith(" Licensed under the MIT License")
            ) {
                continue;
            }
            comments.push(comment);
        }
        return comments.length > 0 ? comments : undefined;
    }
}
