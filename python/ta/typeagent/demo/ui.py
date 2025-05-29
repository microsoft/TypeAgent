# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
import readline  # type: ignore  # For its side-effect of turning on line editing in input().
import sys
from typing import Literal

import typechat

from ..aitools.auth import load_dotenv
from ..knowpro.collections import SemanticRefAccumulator
from ..knowpro.convknowledge import create_typechat_model
from ..knowpro.query import (
    IQueryOpExpr,
    MatchSearchTermExpr,
    MatchTermsAndExpr,
    MatchTermsOrExpr,
    MatchTermsOrMaxExpr,
    QueryEvalContext,
)
from ..knowpro.interfaces import (
    PropertySearchTerm,
    SearchTerm,
    SearchTermGroup,
    SearchTermGroupTypes,
)
from ..podcasts.podcast import Podcast

from .search_query_schema import SearchFilter


def main() -> None:
    load_dotenv()
    translator = create_translator()
    file = "testdata/Episode_53_AdrianTchaikovsky_index"
    pod = Podcast.read_from_file(file)
    assert pod is not None, f"Failed to load podcast from {file!r}"
    # TODO: change QueryEvalContext to take [TMessage, TTermToSemanticRefIndex].
    context = QueryEvalContext(conversation=pod)  # type: ignore
    print("TypeAgent demo UI 0.1 (type 'q' to exit)")
    try:
        read_commands(translator, context, sys.stdin)  # type: ignore  # Why is stdin not a TextIOWrapper?!
    except KeyboardInterrupt:
        print()


def create_translator() -> typechat.TypeChatJsonTranslator[SearchFilter]:
    model = create_typechat_model()  # TODO: Move out of here.
    schema = SearchFilter  # TODO: Use SearchTermGroup when ready.
    type_name = schema.__name__
    validator = typechat.TypeChatValidator[schema](schema)
    translator = typechat.TypeChatJsonTranslator[schema](model, validator, schema)
    schema_text = translator._schema_str.rstrip()  # type: ignore  # No other way.
    print(f"TypeScript schema for {type_name}:\n{schema_text}\n")
    return translator


def read_commands(
    translator: typechat.TypeChatJsonTranslator[SearchFilter],
    context: QueryEvalContext,
    stream: io.TextIOWrapper,
) -> None:
    ps1 = "--> "
    while True:
        line = read_one_line(ps1, stream)
        if line is None:  # EOF
            break
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            break
        search_terms = translate_command(translator, line)
        if search_terms is None:
            print("Failed to translate command to search terms.")
            continue
        print(f"Search terms: {search_terms}")
        # query = compile_query(search_terms)
        # if query is None:
        #     print("Failed to compile search terms to query.")
        #     continue
        # print(f"Query: {query}")
        # result: SemanticRefAccumulator | None = eval_query(query, context)
        # if result is None:
        #     print("Query execution failed.")
        #     continue
        # print(f"Results: {result.to_scored_semantic_refs()}")


def read_one_line(ps1: str, stream: io.TextIOWrapper) -> str | None:
    """Read a single line from the input stream. Return None for EOF."""
    if stream is sys.stdin:
        try:
            return input(ps1).strip()
        except EOFError:
            print()
            return None
    else:
        print(ps1, end="", flush=True)
        line = stream.readline()
        if not line:
            print()
            return None
        return line.strip()


def translate_command(
    translator: typechat.TypeChatJsonTranslator[SearchFilter], command: str
) -> SearchFilter | None:
    result: typechat.Result[SearchFilter] = asyncio.run(
        translator.translate(
            f"Please convert the following user query to a SearchTermGroup:"
            f"\n'''{command}\n'''\n"
        )
    )
    if isinstance(result, typechat.Failure):
        print(f"Error translating {command!r}: {result.message}")
        return None
    return result.value


def compile_query(
    search_term: SearchTermGroupTypes,
) -> IQueryOpExpr[SemanticRefAccumulator | None] | None:
    if isinstance(search_term, SearchTermGroup):
        table: dict[
            Literal["and", "or", "or_max"],
            type[MatchTermsAndExpr | MatchTermsOrExpr | MatchTermsOrMaxExpr],
        ] = {
            "and": MatchTermsAndExpr,
            "or": MatchTermsOrExpr,
            "or_max": MatchTermsOrMaxExpr,
        }
        txs: list[IQueryOpExpr[SemanticRefAccumulator | None]] = []
        for term in search_term.terms:
            tx = compile_query(term)
            if tx is None:
                print(f"Cannot compile {term} .")
                return None
            txs.append(tx)
        return table[search_term.boolean_op](term_expressions=txs)

    if isinstance(search_term, SearchTerm):
        return MatchSearchTermExpr(search_term)

    assert isinstance(search_term, PropertySearchTerm)
    print("PropertySearchTerm not yet supported")
    return None


def eval_query(
    query: IQueryOpExpr[SemanticRefAccumulator | None], context: QueryEvalContext
) -> SemanticRefAccumulator | None:
    return query.eval(context)


if __name__ == "__main__":
    main()
