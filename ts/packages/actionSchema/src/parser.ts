// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionAliasTypeDefinition,
    ActionInterfaceTypeDefinition,
    ActionParamObject,
    ActionParamObjectFields,
    ActionParamStringUnion,
    ActionParamType,
    ActionParamTypeReference,
    ActionParamTypeUnion,
    ActionSchema,
    ActionSchemaTypeDefinition,
    ActionTypeDefinition,
} from "./type.js";

function toActionSchema(
    translatorName: string,
    definition: ActionTypeDefinition,
    name: string,
): ActionSchema {
    if (definition.type.type !== "object") {
        throw new Error("Expected object type");
    }
    const { actionName, parameters } = definition.type.fields;
    if (actionName === undefined) {
        throw new Error(
            `Missing actionName field in type ${name ?? "<unknown>"}`,
        );
    }
    if (actionName.optional) {
        throw new Error("actionName field must be required");
    }
    if (
        actionName.type.type !== "string-union" ||
        actionName.type.typeEnum.length !== 1
    ) {
        throw new Error("actionName field must be a string literal");
    }

    const parameterFieldType = parameters?.type;
    if (
        parameterFieldType !== undefined &&
        parameterFieldType.type !== "object"
    ) {
        throw new Error("parameters field must be an object");
    }
    return {
        translatorName: translatorName,
        typeName: name,
        definition: definition as ActionSchemaTypeDefinition,
        actionName: actionName.type.typeEnum[0],
    };
}

export function parseActionSchemaFile(
    filename: string,
    translatorName: string,
    typeName: string,
): ActionSchema[] {
    const parser = new ActionParser();
    const definition = parser.parseSchema(filename, typeName);
    if (definition === undefined) {
        throw new Error(`Type ${typeName} not found`);
    }

    switch (definition.type.type) {
        case "object":
            return [toActionSchema(translatorName, definition, typeName)];
        case "type-union":
            return definition.type.types.map((t) => {
                if (t.type !== "type-reference") {
                    throw new Error("Expected type reference");
                }
                return toActionSchema(translatorName, t.definition, t.name);
            });
        case "type-reference":
            return [
                toActionSchema(
                    translatorName,
                    definition.type.definition,
                    typeName,
                ),
            ];
        default:
            throw new Error(
                `Expected object or type union, got ${definition.type.type}`,
            );
    }
}

import ts from "typescript";

class ActionParser {
    public parseSchema(
        fileName: string,
        typeName: string,
    ): ActionTypeDefinition | undefined {
        const options: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES5,
            module: ts.ModuleKind.CommonJS,
        };

        const program = ts.createProgram([fileName], options);
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                this.fullText = sourceFile.getFullText();
                ts.forEachChild(sourceFile, (node: ts.Node) => {
                    this.parseAST(node);
                });

                for (const pending of this.pendingReferences.values()) {
                    const resolvedType = this.typeMap.get(pending.name);
                    if (resolvedType === undefined) {
                        throw new Error(`Type ${pending.name} not found`);
                    }
                    pending.definition = resolvedType;
                }
            }
        }
        const result = this.typeMap.get(typeName);
        this.typeMap.clear();
        this.pendingReferences.clear();
        return result;
    }

    private fullText = "";
    private typeMap = new Map<string, ActionTypeDefinition>();
    private pendingReferences = new Map<string, ActionParamTypeReference>();
    private parseAST(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.TypeAliasDeclaration:
                this.parseTypeAliasDeclaration(node as ts.TypeAliasDeclaration);
                break;
            case ts.SyntaxKind.InterfaceDeclaration:
                this.parseInterfaceDeclaration(node as ts.InterfaceDeclaration);
                break;
            case ts.SyntaxKind.EndOfFileToken:
                break;
            default:
                throw new Error(
                    `Unhandled node type ${ts.SyntaxKind[node.kind]}`,
                );
        }
    }

    private checkModifiers(modifiers?: ts.NodeArray<ts.ModifierLike>): void {
        if (modifiers !== undefined && modifiers.length > 0) {
            for (const modifier of modifiers) {
                if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
                    continue;
                }
                throw new Error(`Modifier are not supported ${modifier}`);
            }
        }
    }
    private parseTypeAliasDeclaration(node: ts.TypeAliasDeclaration): void {
        const name = node.name.text;
        try {
            if (node.typeParameters) {
                throw new Error("Generics are not supported");
            }
            this.checkModifiers(node.modifiers);
            const type = this.parseType(node.type);
            const definition: ActionAliasTypeDefinition = {
                alias: true,
                name,
                type,
                comments: this.getCommentStrings(node),
            };
            this.typeMap.set(name, definition);
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
            this.checkModifiers(node.modifiers);
            if (node.heritageClauses) {
                throw new Error("Heritage clauses are not supported");
            }
            const type = this.parseObjectType(node);
            const definition: ActionInterfaceTypeDefinition = {
                alias: false,
                name,
                type,
                comments: this.getCommentStrings(node),
            };
            this.typeMap.set(name, definition);
        } catch (e: any) {
            throw new Error(
                `Error parsing interface type ${name}: ${e.message}`,
            );
        }
    }

    private parseType(node: ts.TypeNode): ActionParamType {
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
            default:
                throw new Error(
                    `Unhandled type node ${ts.SyntaxKind[node.kind]}`,
                );
        }
    }

    private parseTypeReference(
        node: ts.TypeReferenceNode,
    ): ActionParamTypeReference {
        if (node.typeName.kind === ts.SyntaxKind.QualifiedName) {
            throw new Error("Qualified name not supported in type references");
        }
        const typeName = node.typeName.text;

        const existing = this.pendingReferences.get(typeName);
        if (existing) {
            return existing;
        }
        const result: ActionParamTypeReference = {
            type: "type-reference",
            name: typeName,
            definition: undefined!, // we will make sure this get resolved later.
        };
        this.pendingReferences.set(typeName, result);
        return result;
    }
    private parseArrayType(node: ts.ArrayTypeNode): ActionParamType {
        const elementType = this.parseType(node.elementType);
        return {
            type: "array",
            elementType,
        };
    }

    private parseStringUnionType(
        node: ts.UnionTypeNode,
    ): ActionParamStringUnion {
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

    private parseLiteralType(node: ts.LiteralTypeNode): ActionParamStringUnion {
        if (node.literal.kind !== ts.SyntaxKind.StringLiteral) {
            throw new Error("Only string literal types are supported");
        }
        return {
            type: "string-union",
            typeEnum: [node.literal.text],
        };
    }

    private parseTypeUnionType(node: ts.UnionTypeNode): ActionParamTypeUnion {
        const types = node.types.map((type) => this.parseType(type));
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

    private parseObjectType(
        node: ts.TypeLiteralNode | ts.InterfaceDeclaration,
    ): ActionParamObject {
        const fields: ActionParamObjectFields = {};
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
                        comments: this.getCommentStrings(member),
                    };
                }
            }
        }
        return {
            type: "object",
            fields,
        };
    }

    private getCommentStrings(node: ts.Node) {
        const commentRanges = ts.getLeadingCommentRanges(
            this.fullText,
            node.getFullStart(),
        );
        return commentRanges?.map((r) =>
            r.kind === ts.SyntaxKind.MultiLineCommentTrivia
                ? "" // Not supported
                : this.fullText.slice(r.pos + 2, r.end).trim(),
        );
    }
}
