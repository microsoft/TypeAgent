// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamSpec } from "action-schema";
import { ConstructionPart, WildcardMode } from "./constructions.js";
import { isMatchPart } from "./matchPart.js";
import { PropertyParser, getPropertyParser } from "./propertyParser.js";

export class ParsePart implements ConstructionPart {
    constructor(
        public readonly propertyName: string,
        private readonly parser: PropertyParser,
    ) {}
    public get wildcardMode() {
        return WildcardMode.Disabled;
    }
    public get capture() {
        return true;
    }
    public get regExp() {
        return this.parser.regExp;
    }
    public get optional() {
        return false;
    }

    public convertToValue(match: string) {
        return this.parser.convertToValue(match);
    }

    public equals(e: ConstructionPart): boolean {
        return (
            isParsePart(e) &&
            e.propertyName === this.propertyName &&
            e.parser === this.parser
        );
    }

    public toJSON(): ParsePartJSON {
        return {
            propertyName: this.propertyName,
            parserName: this.parser.name,
        };
    }

    public toString(verbose: boolean = false) {
        return `<P:${this.parser.name}${verbose ? `=${this.propertyName}` : ""}>`;
    }

    public getCompletion(): Iterable<string> | undefined {
        // Parse parts don't have completions.
        return undefined;
    }
}

export type ParsePartJSON = {
    propertyName: string;
    parserName: ParamSpec;
};

export function createParsePart(
    propertyName: string,
    parser: PropertyParser,
): ConstructionPart {
    return new ParsePart(propertyName, parser);
}

export function createParsePartFromJSON(json: ParsePartJSON): ConstructionPart {
    const parser = getPropertyParser(json.parserName);
    if (parser === undefined) {
        throw new Error(`Unable to resolve property parser ${json.parserName}`);
    }
    return createParsePart(json.propertyName, parser);
}

export function isParsePart(part: ConstructionPart): part is ParsePart {
    return !isMatchPart(part);
}
