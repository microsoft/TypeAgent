// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeSchema } from "typeagent";
import { NodeType, SchemaParser, SymbolNode } from "action-schema";

export function loadActionSchema(
    filePathOrSchema: string | SchemaParser,
    typeName: string,
): TypeSchema | undefined {
    let schema: SchemaParser;
    if (typeof filePathOrSchema === "string") {
        schema = new SchemaParser();
        schema.loadSchema(filePathOrSchema);
    } else {
        schema = filePathOrSchema;
    }
    const node = schema.openActionNode(typeName);
    if (!node) {
        return;
    }
    let schemaText = getTypeSchema(schema, typeName, node.symbol.valueType);
    const refTypes = getReferencedTypes(node);
    if (refTypes) {
        let refTypesSchema = getSchemaForReferencedTypes(schema, refTypes);
        schemaText = appendBlock(schemaText, refTypesSchema);
    }
    return {
        typeName,
        schemaText,
    };
}

function getReferencedTypes(
    node: SymbolNode,
    types?: Map<string, NodeType>,
): Map<string, NodeType> | undefined {
    if (node.children) {
        for (const child of node.children) {
            types = getReferencedTypes(child, types);
        }
    }
    if (
        node.symbol.type === NodeType.TypeReference &&
        node.symbol.valueType === NodeType.Object
    ) {
        types ??= new Map<string, NodeType>();
        types.set(node.symbol.value, node.symbol.valueType);
    }
    return types;
}

function getNodeSchema(node: SymbolNode): string {
    let schemaText: string = node.leadingComments
        ? joinComments(node.leadingComments)
        : "";
    schemaText = appendBlock(
        schemaText,
        `export interface ${node.symbol.name}`,
    );
    return appendBlock(schemaText, node.symbol.value);
}

function getSchemaForReferencedTypes(
    schema: SchemaParser,
    types: Map<string, NodeType>,
): string {
    let schemaText = "";
    for (const typeName of types.keys()) {
        schemaText = appendBlock(
            schemaText,
            getTypeSchema(schema, typeName, types.get(typeName)!),
        );
    }
    return schemaText;
}

function getTypeSchema(
    schema: SchemaParser,
    typeName: string,
    type: NodeType,
): string {
    const typeNode = schema.openActionNode(typeName);
    if (!typeNode) {
        return "";
    }
    return getNodeSchema(typeNode);
}

function joinComments(comments: string[]): string {
    let comment = "/*\n";
    comment += comments.join("\n");
    comment += "\n*/";
    return comment;
}

function appendBlock(text: string, newBlock?: string): string {
    if (newBlock && newBlock.length > 0) {
        if (text.length > 0) {
            text += "\n";
        }
        text += newBlock;
    }
    return text;
}
