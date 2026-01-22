// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Quick test script for schema reader
import { loadSchemaInfo, getWildcardType } from "./schemaReader.js";

const playerSchemaPath = "../agents/player/dist/agent/playerSchema.pas.json";

console.log("Loading player schema...");
const schemaInfo = loadSchemaInfo(playerSchemaPath);

console.log(`\nSchema: ${schemaInfo.schemaName}`);
console.log(`Entity types: ${Array.from(schemaInfo.entityTypes).join(", ")}`);
console.log(`\nActions (${schemaInfo.actions.size}):`);

for (const [actionName, actionInfo] of schemaInfo.actions.entries()) {
    console.log(`\n  ${actionName}:`);
    if (actionInfo.parameters.size === 0) {
        console.log("    (no parameters)");
    } else {
        for (const [
            paramName,
            validationInfo,
        ] of actionInfo.parameters.entries()) {
            const wildcardType = getWildcardType(validationInfo);
            const spec = validationInfo.paramSpec || "(no spec)";
            const entityInfo = validationInfo.isEntityType
                ? ` [entity: ${validationInfo.entityTypeName}]`
                : "";
            console.log(
                `    ${paramName}: ${wildcardType} (${spec})${entityInfo}`,
            );
        }
    }
}
