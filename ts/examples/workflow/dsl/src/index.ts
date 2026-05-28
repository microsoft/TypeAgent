// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    compile,
    compileFile,
    CompileResult,
    CompileError,
    CompileOptions,
} from "./compiler.js";
export {
    FileResolver,
    LoadError,
    LoadedModule,
    LoadResult,
} from "./fileLoader.js";
export { lex, TokenKind, Token, LexError, LexComment } from "./lexer.js";
export { Parser, ParseError } from "./parser.js";
export {
    TypeChecker,
    TypeInfo,
    TypeError,
    PropertyRef,
    formatType,
} from "./typeChecker.js";
export {
    Emitter,
    TaskSchemaInfo,
    ConcreteTaskSchemaInfo,
    GenericTaskSchemaInfo,
    isGenericSchema,
    TaskSchemaTypeParam,
    EmitError,
} from "./emitter.js";
export {
    ResolvedTaskSchemas,
    resolveGenericSchemas,
    resolveTypeParams,
    typeExprToSchema,
} from "./typeParamUtils.js";
export { formatModule, FormatOptions } from "./formatter.js";
export {
    decodeStringLiteral,
    decodeTemplatePart,
    encodeStringLiteral,
    quoteStringLiteral,
    StringQuote,
    DecodeError,
    DecodeResult,
} from "./literal.js";
export {
    extractGraph,
    GraphModel,
    GraphNode,
    GraphEdge,
    GraphGroup,
    ParamNode,
} from "./graphExtractor.js";
export {
    WorkflowDecl,
    ParamDecl,
    TypeExpr,
    Statement,
    Expr,
    TaskCallExpr,
    DottedNameExpr,
    SourceLocation,
    Comment,
    Module,
    ImportDecl,
    DEFAULT_FALLBACK_PARAM,
} from "./ast.js";
