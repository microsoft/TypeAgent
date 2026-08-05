// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { invalidArgument, requireText } from "../../domain/index.js";
import {
    normalizeQuery,
    type FilterExpression,
    type NormalizedQueryIrV1,
    type QueryEntityKind,
    type QueryExpression,
    type QueryIrV1,
    type QueryOrder,
    type QueryScalar,
    type StructuralSource,
    type TopicSelector,
} from "../ir/index.js";
import { createResolvedTimezone, IntlTemporalResolver } from "./temporal.js";
import type { QueryLanguageOptions, TemporalResolver } from "./types.js";

const maximumInputLength = 16_384;
const maximumParserDepth = 16;
const controlKeywords = new Set([
    "where",
    "filter",
    "during",
    "asof",
    "changed",
    "detail",
    "order",
    "limit",
    "tokens",
]);

type Token = {
    type: "word" | "string" | "symbol";
    value: string;
};

type PathSegment = {
    value: string;
    literal: boolean;
};

type ParsedPath = {
    targetKinds: QueryEntityKind[];
    topic?: TopicSelector;
    source?: StructuralSource;
    filters: FilterExpression[];
};

export function parseQueryLanguage(
    input: string,
    options: QueryLanguageOptions,
    temporalResolver: TemporalResolver = new IntlTemporalResolver(),
): NormalizedQueryIrV1 {
    if (input.length > maximumInputLength) {
        return invalidArgument("Query language input is too long", {
            maximumInputLength,
        });
    }
    const sourceText = requireText(input, "query");
    const { path, controls } = splitPathAndControls(sourceText);
    const parsedPath = parsePath(path);
    const tokens = tokenize(controls);
    const cursor = new TokenCursor(tokens);
    let expression: QueryExpression | undefined;
    const filters = [...parsedPath.filters];
    let temporal: QueryIrV1["temporal"];
    let timezone = createResolvedTimezone(options);
    let detail: QueryIrV1["detail"] = "cards";
    let orderBy: QueryOrder[] | undefined;
    let maxResults = options.defaultMaxResults ?? 100;
    let tokenBudget = options.defaultTokenBudget ?? 1_024;

    while (!cursor.done) {
        const control = cursor.takeWord("query control").toLowerCase();
        switch (control) {
            case "where":
                if (expression !== undefined) {
                    return invalidArgument(
                        "Query may contain only one where clause",
                    );
                }
                expression = new ExpressionParser(cursor).parse();
                break;
            case "filter":
                filters.push(parseFilter(cursor));
                break;
            case "during": {
                requireNoTemporal(temporal);
                const resolution = temporalResolver.resolve(
                    takeControlValue(cursor, "during"),
                    "during",
                    options,
                );
                temporal = resolution.selector;
                timezone = resolution.timezone;
                break;
            }
            case "asof": {
                requireNoTemporal(temporal);
                const resolution = temporalResolver.resolve(
                    takeControlValue(cursor, "asof"),
                    "asOf",
                    options,
                );
                temporal = resolution.selector;
                timezone = resolution.timezone;
                break;
            }
            case "changed": {
                requireNoTemporal(temporal);
                const values = takeControlTokens(cursor, "changed");
                const projectionToken = values.at(-1)?.toLowerCase();
                const projection =
                    projectionToken === "endstate" ||
                    projectionToken === "matchingevents"
                        ? values.pop()!.toLowerCase() === "endstate"
                            ? "endState"
                            : "matchingEvents"
                        : "matchingEvents";
                const resolution = temporalResolver.resolve(
                    values.join(" "),
                    "changedDuring",
                    options,
                    projection,
                );
                temporal = resolution.selector;
                timezone = resolution.timezone;
                break;
            }
            case "detail":
                detail = parseDetail(cursor.takeValue("detail"));
                break;
            case "order":
                orderBy = parseOrder(cursor.takeValue("order"));
                break;
            case "limit":
                maxResults = parseInteger(cursor.takeValue("limit"), "limit");
                break;
            case "tokens":
                tokenBudget = parseInteger(
                    cursor.takeValue("tokens"),
                    "tokens",
                );
                break;
            default:
                return invalidArgument("Unknown query control", { control });
        }
    }

    expression = combineWithFilters(expression, filters);
    if (expression === undefined) {
        expression = {
            type: "filter",
            field: "entityId",
            operator: "exists",
        };
    }

    return normalizeQuery({
        version: 1,
        scopeId: options.scopeId,
        targetKinds: parsedPath.targetKinds,
        expression,
        ...(parsedPath.source === undefined
            ? {}
            : { source: parsedPath.source }),
        ...(parsedPath.topic === undefined ? {} : { topic: parsedPath.topic }),
        ...(temporal === undefined ? {} : { temporal }),
        ...(orderBy === undefined ? {} : { orderBy }),
        detail,
        tokenBudget,
        maxResults,
        timezone,
    });
}

function parsePath(path: string): ParsedPath {
    const segments = parsePathSegments(path);
    const root = segments[0]?.value.toLowerCase();
    switch (root) {
        case "topics":
            return parseTopicPath(segments.slice(1));
        case "terms":
            return parseTermPath(segments.slice(1));
        case "artifacts":
            return parseArtifactPath(segments.slice(1));
        case "turns":
            return parseTurnPath(segments.slice(1));
        default:
            return invalidArgument("Unsupported query path root", { root });
    }
}

function parseTopicPath(segments: PathSegment[]): ParsedPath {
    if (segments.length === 0) {
        return invalidArgument("Topic query requires a topic path");
    }
    let targetKind: QueryEntityKind = "topic";
    const filters: FilterExpression[] = [];
    const propertyIndex = segments
        .map((segment) =>
            segment.value === "properties" && !segment.literal
                ? "properties"
                : "",
        )
        .lastIndexOf("properties");
    if (propertyIndex >= 0) {
        if (propertyIndex !== segments.length - 2) {
            return invalidArgument("Property path requires exactly one key");
        }
        targetKind = "property";
        filters.push({
            type: "filter",
            field: "propertyName",
            operator: "equals",
            value: segments.at(-1)!.value,
        });
        segments = segments.slice(0, propertyIndex);
    } else {
        const lastSegment = segments.at(-1)!;
        const suffixKind =
            lastSegment.literal || segments.length === 1
                ? undefined
                : topicSuffixKinds[lastSegment.value];
        if (suffixKind !== undefined) {
            targetKind = suffixKind;
            segments = segments.slice(0, -1);
        }
    }
    if (segments.length === 0) {
        return invalidArgument("Topic query requires a topic path");
    }
    let traversal: TopicSelector["traversal"] = "exact";
    const wildcard = segments.at(-1)!;
    if (
        !wildcard.literal &&
        (wildcard.value === "*" || wildcard.value === "**")
    ) {
        traversal = wildcard.value === "*" ? "children" : "descendants";
        segments = segments.slice(0, -1);
    }
    if (
        segments.length === 0 ||
        segments.some(
            (segment) =>
                segment.value.includes("/") ||
                (!segment.literal && segment.value.includes("*")),
        )
    ) {
        return invalidArgument(
            "Topic wildcards are allowed only after a topic path",
        );
    }
    return {
        targetKinds: [targetKind],
        topic: {
            rootPath: `/${segments.map((segment) => segment.value).join("/")}`,
            traversal,
        },
        filters,
    };
}

function parseTermPath(segments: PathSegment[]): ParsedPath {
    if (
        segments.length !== 2 ||
        segments[1]!.literal ||
        !new Set(["topics", "turns"]).has(segments[1]!.value)
    ) {
        return invalidArgument("Term path must end in /topics or /turns");
    }
    return {
        targetKinds: [segments[1]!.value === "topics" ? "topic" : "turn"],
        source: {
            type: "term",
            term: requireText(segments[0]!.value, "term"),
        },
        filters: [],
    };
}

function parseArtifactPath(segments: PathSegment[]): ParsedPath {
    if (
        segments.length !== 2 ||
        segments[1]!.literal ||
        segments[1]!.value !== "turns"
    ) {
        return invalidArgument("Artifact path must end in /turns");
    }
    return {
        targetKinds: ["turn"],
        source: { type: "artifact", artifactId: segments[0]!.value },
        filters: [],
    };
}

function parseTurnPath(segments: PathSegment[]): ParsedPath {
    if (segments.length !== 1) {
        return invalidArgument("Turn path requires exactly one turn ID");
    }
    return {
        targetKinds: ["turn"],
        source: { type: "turn", turnId: segments[0]!.value },
        filters: [],
    };
}

const topicSuffixKinds: Readonly<Record<string, QueryEntityKind>> = {
    turns: "turn",
    terms: "term",
    actions: "action",
    artifacts: "artifact",
    goals: "goal",
    outputs: "output",
    "design-notes": "designNote",
};

class ExpressionParser {
    private depth = 0;

    public constructor(private readonly cursor: TokenCursor) {}

    public parse(): QueryExpression {
        const expression = this.parseSoftAnd();
        if (
            this.cursor.peek()?.type === "symbol" &&
            this.cursor.peek()?.value === ")"
        ) {
            return invalidArgument("Unexpected closing parenthesis");
        }
        return expression;
    }

    private parseSoftAnd(): QueryExpression {
        return this.parseBinary("+", "softAnd", () => this.parseOr());
    }

    private parseOr(): QueryExpression {
        return this.parseBinary("|", "or", () => this.parseAnd());
    }

    private parseAnd(): QueryExpression {
        return this.parseBinary("&", "and", () => this.parseUnary());
    }

    private parseBinary(
        operator: string,
        type: "and" | "or" | "softAnd",
        parseChild: () => QueryExpression,
    ): QueryExpression {
        const children = [parseChild()];
        while (this.cursor.takeSymbolIf(operator)) {
            children.push(parseChild());
        }
        return children.length === 1 ? children[0]! : { type, children };
    }

    private parseUnary(): QueryExpression {
        if (this.cursor.takeSymbolIf("!")) {
            return { type: "not", child: this.parseUnary() };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): QueryExpression {
        if (this.cursor.takeSymbolIf("(")) {
            this.depth++;
            if (this.depth > maximumParserDepth) {
                return invalidArgument("Query expression nesting is too deep", {
                    maximumParserDepth,
                });
            }
            const expression = this.parseSoftAnd();
            this.cursor.expectSymbol(")");
            this.depth--;
            return expression;
        }
        const value = this.cursor.takeExpressionValue();
        if (this.cursor.takeSymbolIf("=")) {
            return {
                type: "filter",
                field: value,
                operator: "equals",
                value: parseScalar(this.cursor.takeExpressionValue()),
            };
        }
        const text = requireText(value, "match term");
        return {
            type: "match",
            clauseId: createClauseId(text),
            text,
        };
    }
}

class TokenCursor {
    private index = 0;

    public constructor(private readonly tokens: readonly Token[]) {}

    public get done(): boolean {
        return this.index >= this.tokens.length;
    }

    public peek(): Token | undefined {
        return this.tokens[this.index];
    }

    public takeWord(name: string): string {
        const token = this.tokens[this.index];
        if (token?.type !== "word") {
            return invalidArgument(`${name} must be an unquoted word`);
        }
        this.index++;
        return token.value;
    }

    public takeValue(name: string): string {
        const token = this.tokens[this.index];
        if (token === undefined || token.type === "symbol") {
            return invalidArgument(`${name} requires a value`);
        }
        this.index++;
        return token.value;
    }

    public takeExpressionValue(): string {
        const token = this.tokens[this.index];
        if (
            token === undefined ||
            token.type === "symbol" ||
            (token.type === "word" &&
                controlKeywords.has(token.value.toLowerCase()))
        ) {
            return invalidArgument("Expected a query expression term");
        }
        this.index++;
        return token.value;
    }

    public takeSymbolIf(value: string): boolean {
        const token = this.tokens[this.index];
        if (token?.type === "symbol" && token.value === value) {
            this.index++;
            return true;
        }
        return false;
    }

    public expectSymbol(value: string): void {
        if (!this.takeSymbolIf(value)) {
            invalidArgument(`Expected '${value}'`);
        }
    }

    public takeUntilControl(): string[] {
        const values: string[] = [];
        while (!this.done) {
            const token = this.peek()!;
            if (
                token.type === "word" &&
                controlKeywords.has(token.value.toLowerCase())
            ) {
                break;
            }
            if (token.type === "symbol") {
                return invalidArgument(
                    "Temporal values must be quoted when they contain punctuation",
                );
            }
            values.push(token.value);
            this.index++;
        }
        return values;
    }
}

function parseFilter(cursor: TokenCursor): FilterExpression {
    const field = cursor.takeWord("filter field");
    cursor.expectSymbol("=");
    return {
        type: "filter",
        field,
        operator: "equals",
        value: parseScalar(cursor.takeValue("filter")),
    };
}

function combineWithFilters(
    expression: QueryExpression | undefined,
    filters: FilterExpression[],
): QueryExpression | undefined {
    const children = [
        ...(expression === undefined ? [] : [expression]),
        ...filters,
    ];
    return children.length === 0
        ? undefined
        : children.length === 1
          ? children[0]
          : { type: "and", children };
}

function takeControlValue(cursor: TokenCursor, name: string): string {
    return takeControlTokens(cursor, name).join(" ");
}

function takeControlTokens(cursor: TokenCursor, name: string): string[] {
    const values = cursor.takeUntilControl();
    if (values.length === 0) {
        return invalidArgument(`${name} requires a value`);
    }
    return values;
}

function parseDetail(value: string): QueryIrV1["detail"] {
    if (value !== "cards" && value !== "snippets" && value !== "full") {
        return invalidArgument("Invalid detail level", { value });
    }
    return value;
}

function parseOrder(value: string): QueryOrder[] {
    return value.split(",").map((part) => {
        const [field, direction = "asc"] = part.split(":");
        return {
            field: field as QueryOrder["field"],
            direction: direction as QueryOrder["direction"],
        };
    });
}

function parseInteger(value: string, name: string): number {
    if (!/^\d+$/.test(value)) {
        return invalidArgument(`${name} must be an integer`, { value });
    }
    return Number(value);
}

function parseScalar(value: string): QueryScalar {
    if (value === "true" || value === "false") {
        return value === "true";
    }
    if (/^-?(?:\d+|\d+\.\d+)$/.test(value)) {
        return Number(value);
    }
    return value;
}

function requireNoTemporal(temporal: QueryIrV1["temporal"]): void {
    if (temporal !== undefined) {
        invalidArgument("Query may contain only one temporal selector");
    }
}

function createClauseId(text: string): string {
    const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
    return `match-${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function splitPathAndControls(input: string): {
    path: string;
    controls: string;
} {
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < input.length; index++) {
        const character = input[index]!;
        if (escaped) {
            escaped = false;
        } else if (character === "\\") {
            escaped = true;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (/\s/.test(character) && !quoted) {
            return {
                path: input.slice(0, index),
                controls: input.slice(index).trim(),
            };
        }
    }
    if (quoted || escaped) {
        return invalidArgument("Unterminated quote or escape in query path");
    }
    return { path: input, controls: "" };
}

function parsePathSegments(path: string): PathSegment[] {
    if (!path.startsWith("/")) {
        return invalidArgument("Query path must start with '/'");
    }
    const segments: PathSegment[] = [];
    let current = "";
    let literal = false;
    let quoted = false;
    let escaped = false;
    for (const character of path.slice(1)) {
        if (escaped) {
            current += character;
            escaped = false;
        } else if (character === "\\") {
            literal = true;
            escaped = true;
        } else if (character === '"') {
            literal = true;
            quoted = !quoted;
        } else if (character === "/" && !quoted) {
            segments.push(decodeSegment(current, literal));
            current = "";
            literal = false;
        } else {
            current += character;
        }
    }
    if (quoted || escaped) {
        return invalidArgument("Unterminated quote or escape in query path");
    }
    segments.push(decodeSegment(current, literal));
    if (segments.some((segment) => segment.value.length === 0)) {
        return invalidArgument("Query path contains an empty segment");
    }
    return segments;
}

function decodeSegment(value: string, literal: boolean): PathSegment {
    try {
        const decoded = decodeURIComponent(value);
        return { value: decoded, literal: literal || decoded !== value };
    } catch {
        return invalidArgument("Query path contains invalid percent encoding");
    }
}

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    for (let index = 0; index < input.length; ) {
        const character = input[index]!;
        if (/\s/.test(character)) {
            index++;
            continue;
        }
        if ("()&|+!=".includes(character)) {
            tokens.push({ type: "symbol", value: character });
            index++;
            continue;
        }
        if (character === '"') {
            let value = "";
            index++;
            let closed = false;
            while (index < input.length) {
                const next = input[index++]!;
                if (next === "\\") {
                    if (index >= input.length) {
                        return invalidArgument("Unterminated quoted escape");
                    }
                    value += input[index++]!;
                } else if (next === '"') {
                    closed = true;
                    break;
                } else {
                    value += next;
                }
            }
            if (!closed) {
                return invalidArgument("Unterminated quoted string");
            }
            tokens.push({ type: "string", value });
            continue;
        }
        let value = "";
        while (
            index < input.length &&
            !/\s/.test(input[index]!) &&
            !"()&|+!=".includes(input[index]!)
        ) {
            value += input[index++]!;
        }
        tokens.push({ type: "word", value });
    }
    return tokens;
}
