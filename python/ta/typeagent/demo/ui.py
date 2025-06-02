# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import io
from pprint import pprint
import readline  # type: ignore  # For its side-effect of turning on line editing in input().
import shutil
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

from .search_query_schema import SearchQuery


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


def create_translator() -> typechat.TypeChatJsonTranslator[SearchQuery]:
    model = create_typechat_model()  # TODO: Move out of here.
    schema = SearchQuery  # TODO: Use SearchTermGroup when ready.
    validator = typechat.TypeChatValidator[schema](schema)
    translator = typechat.TypeChatJsonTranslator[schema](model, validator, schema)
    # schema_text = translator._schema_str.rstrip()  # type: ignore  # No other way.
    # print(f"TypeScript schema for {schema.__name__}:\n{schema_text}\n")
    return translator


def read_commands(
    translator: typechat.TypeChatJsonTranslator[SearchQuery],
    context: QueryEvalContext,
    stream: io.TextIOWrapper,
) -> None:
    ps1 = "--> "
    while True:
        print()
        line = read_one_line(ps1, stream)
        if line is None:  # EOF
            break
        if not line:
            continue
        if line.lower() in ("exit", "quit", "q"):
            break
        search_query = translate_command(translator, line)
        if search_query is None:
            print("Failed to translate command to search terms.")
            continue
        print(f"Search query:")
        pprint(search_query, width=min(200, shutil.get_terminal_size().columns))
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
    if stream is sys.stdin and stream.isatty():
        try:
            return input(ps1).strip()
        except EOFError:
            print()
            return None
    else:
        if stream.isatty():
            print(ps1, end="", flush=True)
        line = stream.readline()
        if not line:
            print()
            return None
        return line.strip()


def translate_command(
    translator: typechat.TypeChatJsonTranslator[SearchQuery], command: str
) -> SearchQuery | None:
    result: typechat.Result[SearchQuery] = asyncio.run(
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
