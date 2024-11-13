// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { SchemaParser, NodeType } from "action-schema";

const filePath = path.join(__dirname, "testSchema.ts");
//const filePath = path.join(__dirname, "testCalendarSchema.ts");

const parser: SchemaParser = new SchemaParser();
parser.loadSchema(filePath);

let actionNames: string[] = parser.actionTypeNames();
console.log("Action Names:", actionNames);

function parseNodeRecursively(indentation: string = ""): void {
    const symbolsUnderNode = parser.symbols();
    if (symbolsUnderNode != undefined) {
        for (const symbol of symbolsUnderNode) {
            if (
                symbol.type === NodeType.Object ||
                symbol.type === NodeType.Interface ||
                symbol.type === NodeType.ObjectArray ||
                symbol.type === NodeType.TypeReference
            ) {
                if (symbol.name === "parameters") {
                    console.log(`${indentation}` + "{");
                } else {
                    console.log(`${indentation}` + `"${symbol.name}"` + ": {");
                }

                parser.open(symbol.name);
                parseNodeRecursively("\t" + indentation);
                parser.close();
                console.log(`${indentation}` + "}");
            } else {
                if (symbol.name === "actionName") {
                    console.log(
                        `${indentation}` +
                            symbol.value.replace(/["']/g, "") +
                            "(",
                    );
                } else {
                    let arrayTerm = symbol.type === NodeType.Array ? "[]" : "";
                    console.log(
                        `${indentation}` + `"${symbol.name}"`,
                        ":",
                        NodeType[symbol.valueType] + arrayTerm,
                    );
                }
            }
        }
    }
}

console.log("Starting to parse PlayAction node...");
parser.open("PlayAction");
//console.log("Starting to parse CalendarAction node...");
//parser.open("AddParticipantsAction");

parseNodeRecursively();
parser.close();
console.log(")");

// console.log("Starting to parse SetVolumeAction node...");
// parser.open("SetVolumeAction");
// parseNodeRecursively();
// parser.close();
// console.log(")");
