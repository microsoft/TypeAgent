# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

__version__ = "0.2"

import argparse
import asyncio
from contextlib import AsyncContextDecorator
from dataclasses import dataclass
import difflib
import json
import sys
import typing

from colorama import init as colorama_init, Fore
import numpy as np

# TODO: These imports must be copied to this file.
from test.cmpsearch import RawSearchResult, compare_and_print_diff, compare_results
from typeagent.demo.ui import print_result

try:
    import readline
except ImportError:
    readline = None
import typechat

from typeagent.aitools import embeddings
from typeagent.aitools import utils

from typeagent.knowpro.interfaces import IMessage, ITermToSemanticRefIndex
from typeagent.knowpro import answers, answer_response_schema
from typeagent.knowpro import convknowledge
from typeagent.knowpro import serialization
from typeagent.knowpro import search, searchlang
from typeagent.knowpro import importing
from typeagent.knowpro import query
from typeagent.knowpro import search_query_schema

from typeagent.podcasts import podcast


@dataclass
class ProcessingContext:
    query_context: query.QueryEvalContext
    ar_index: dict[str, dict[str, typing.Any]]
    sr_index: dict[str, dict[str, typing.Any]]
    debug1: typing.Literal["none", "diff", "full", "skip"]
    debug2: typing.Literal["none", "diff", "full", "skip"]
    debug3: typing.Literal["none", "diff", "full"]
    debug4: typing.Literal["none", "diff", "full", "nice"]
    embedding_model: embeddings.AsyncEmbeddingModel
    query_translator: typechat.TypeChatJsonTranslator[search_query_schema.SearchQuery]
    answer_translator: typechat.TypeChatJsonTranslator[
        answer_response_schema.AnswerResponse
    ]
    lang_search_options: searchlang.LanguageSearchOptions
    answer_context_options: answers.AnswerContextOptions

    def __repr__(self) -> str:
        args = []
        args.append(f"ar_index={len(self.ar_index)}")
        args.append(f"sr_index={len(self.sr_index)}")
        args.append(f"debug1={self.debug1}")
        args.append(f"debug2={self.debug2}")
        args.append(f"debug3={self.debug3}")
        args.append(f"debug4={self.debug4}")
        args.append(f"lang_search_options={self.lang_search_options}")
        args.append(f"answer_context_options={self.answer_context_options}")
        return f"Context({', '.join(args)})"


def main():
    utils.load_dotenv()
    colorama_init(autoreset=True)

    parser = make_arg_parser("TypeAgent Query Tool")
    args = parser.parse_args()
    fill_in_debug_defaults(args)
    query_context = load_podcast_index(args.podcast)
    ar_index = load_index_file(args.qafile, "question")
    sr_index = load_index_file(args.srfile, "searchText")

    model = convknowledge.create_typechat_model()
    query_translator = utils.create_translator(model, search_query_schema.SearchQuery)
    if args.alt_schema:
        print(f"Substituting alt schema from {args.alt_schema}")
        with open(args.alt_schema) as f:
            query_translator.schema_str = f.read()
    if args.show_schema:
        print(Fore.YELLOW + query_translator.schema_str.rstrip() + Fore.RESET)

    answer_translator = utils.create_translator(
        model, answer_response_schema.AnswerResponse
    )

    context = ProcessingContext(
        query_context,
        ar_index,
        sr_index,
        args.debug1,
        args.debug2,
        args.debug3,
        args.debug4,
        embeddings.AsyncEmbeddingModel(),
        query_translator,
        answer_translator,
        searchlang.LanguageSearchOptions(),
        answers.AnswerContextOptions(),
    )

    utils.pretty_print(context, Fore.BLUE, Fore.RESET)

    if args.batch:
        print(
            Fore.YELLOW
            + "Running in batch mode, suppressing interactive prompts."
            + Fore.RESET
        )
        asyncio.run(batch_loop(context))
    else:
        print(Fore.YELLOW + "Running in interactive mode." + Fore.RESET)
        interactive_loop(context)


async def batch_loop(context: ProcessingContext) -> None:
    for query_text in context.sr_index:
        print("-" * 20, repr(query_text), "-" * 20)
        await process_query(context, query_text)


def interactive_loop(context: ProcessingContext) -> None:
    if sys.stdin.isatty():
        print(f"TypeAgent demo UI {__version__} (type 'q' to exit)")
        if readline:
            try:
                readline.read_history_file(".ui_history")
            except FileNotFoundError:
                pass  # Ignore if history file does not exist.

    try:
        while True:
            try:
                line = input("TypeAgent> ").strip()
            except EOFError:
                print()
                break
            if not line:
                continue
            if line.lower() in ("exit", "quit", "q"):
                break
            asyncio.run(process_query(context, line))

    finally:
        if readline and sys.stdin.isatty():
            readline.write_history_file(".ui_history")


async def process_query(context: ProcessingContext, query_text: str) -> None:
    record = context.sr_index.get(query_text)
    if not record:
        print("This query has no precomputed results, running all stages.")
    debug_context = searchlang.LanguageSearchDebugContext()
    if context.debug1 == "skip" or context.debug2 == "skip":
        if not record or (
            "searchQueryExpr" not in record or "compiledQueryExpr" not in record
        ):
            print("Can't skip stages 1 or 2, no precomputed outcomes found.")
        else:
            # Skipping stage 2 implies skipping stage 1, and we must supply the
            # precomputed results for both stages.
            debug_context.use_search_query = serialization.deserialize_object(
                search_query_schema.SearchQuery, record["searchQueryExpr"]
            )
            print("Skipping stage 1, substituting precomputed search query.")
            if context.debug2 == "skip":
                debug_context.use_compiled_search_query_exprs = (
                    serialization.deserialize_object(
                        list[search.SearchQueryExpr],
                        record["compiledQueryExpr"],
                    )
                )
                print(
                    "Skipping stage 2, substituting precomputed compiled query expressions."
                )

    result = await searchlang.search_conversation_with_language(
        context.query_context.conversation,
        context.query_translator,
        query_text,
        context.lang_search_options,
        debug_context=debug_context,
    )
    if isinstance(result, typechat.Failure):
        print("Stages 1-3 failed:")
        print(Fore.RED + str(result) + Fore.RESET)
        return
    search_results = result.value

    actual1 = debug_context.search_query
    if actual1:
        if context.debug1 == "full":
            print("Stage 1 results:")
            utils.pretty_print(actual1, Fore.GREEN, Fore.RESET)
        elif context.debug1 == "diff":
            if record and "searchQueryExpr" in record:
                print("Stage 1 diff:")
                expected1 = serialization.deserialize_object(
                    search_query_schema.SearchQuery, record["searchQueryExpr"]
                )
                compare_and_print_diff(expected1, actual1, "stage 1 mismatch")
            else:
                print("Stage 1 diff unavailable")

    actual2 = debug_context.search_query_expr
    if context.debug2 == "full":
        print("Stage 2 results:")
        utils.pretty_print(actual2, Fore.GREEN, Fore.RESET)
    elif context.debug2 == "diff":
        if record and "compiledQueryExpr" in record:
            print("Stage 2 diff:")
            expected2 = serialization.deserialize_object(
                list[search.SearchQueryExpr], record["compiledQueryExpr"]
            )
            compare_and_print_diff(expected2, actual2, "stage 2 mismatch")
        else:
            print("Stage 2 diff unavailable")

    actual3 = search_results
    if context.debug3 == "full":
        print("Stage 3 results:")
        utils.pretty_print(actual3, Fore.GREEN, Fore.RESET)
    elif context.debug3 == "nice":
        print("Stage 3 'nice' results:")
        for sr in search_results:
            print_result(sr, context.query_context.conversation)
    elif context.debug3 == "diff":
        if record and "results" in record:
            print("Stage 3 diff:")
            expected3: list[RawSearchResult] = record["results"]
            compare_results(expected3, actual3, "stage 3 mismatch")
        else:
            print("Stage 3 diff unavailable")

    all_answers, combined_answer = await answers.generate_answers(
        context.answer_translator,
        search_results,
        context.query_context.conversation,
        query_text,
        options=context.answer_context_options,
    )

    if context.debug4 == "full":
        utils.pretty_print(all_answers)
        print("-" * 50)
    if context.debug4 in ("full", "nice"):
        if combined_answer.type == "NoAnswer":
            print(Fore.RED + f"Failure: {combined_answer.whyNoAnswer}" + Fore.RESET)
        else:
            print(Fore.GREEN + f"{combined_answer.answer}" + Fore.RESET)
        print("-" * 50)
    elif context.debug4 == "diff":
        if query_text in context.ar_index:
            record = context.ar_index[query_text]
            expected4: tuple[str, bool] = (record["answer"], not record["hasNoAnswer"])
            print("Stage 4 diff:")
            match combined_answer.type:
                case "NoAnswer":
                    actual4 = (combined_answer.whyNoAnswer or "", False)
                case "Answered":
                    actual4 = (combined_answer.answer or "", True)
            score = await compare_answers(
                context, expected4, actual4, "stage 4 mismatch"
            )
            print(f"Score: {score:.3f}")
        else:
            print("Stage 4 diff unavailable")


def make_arg_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)

    default_podcast_file = "testdata/Episode_53_AdrianTchaikovsky_index"
    parser.add_argument(
        "--podcast",
        type=str,
        default=default_podcast_file,
        help="Path to the podcast index files (excluding the '_index.json' suffix)",
    )
    default_qafile = "testdata/Episode_53_Answer_results.json"
    explain_qa = "a list of questions and answers to test the full pipeline"
    parser.add_argument(
        "--qafile",
        type=str,
        default=default_qafile,
        help=f"Path to the Answer_results.json file ({explain_qa})",
    )
    default_srfile = "testdata/Episode_53_Search_results.json"
    explain_sr = "a list of intermediate results from stages 1, 2 and 3"
    parser.add_argument(
        "--srfile",
        type=str,
        default=default_srfile,
        help=f"Path to the Search_results.json file ({explain_sr})",
    )
    parser.add_argument(
        "--alt-schema",
        type=str,
        default=None,
        help="Path to alternate schema file for query translator (modifies stage 1).",
    )
    parser.add_argument(
        "--show-schema",
        action="store_true",
        help="Show the TypeScript schema computed by typechat.",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Run in batch mode, suppressing interactive prompts.",
    )
    parser.add_argument(
        "--debug",
        type=str,
        default=None,
        choices=["none", "diff", "full"],
        help="Default debug level: 'none' for no debug output, 'diff' for diff output, "
        "'full' for full debug output.",
    )
    arg_helper = lambda key: typing.get_args(ProcessingContext.__annotations__[key])
    parser.add_argument(
        "--debug1",
        type=str,
        default=None,
        choices=arg_helper("debug1"),
        help="Debug level override for stage 1: like --debug; or 'skip' to skip stage 1.",
    )
    parser.add_argument(
        "--debug2",
        type=str,
        default=None,
        choices=arg_helper("debug2"),
        help="Debug level override for stage 2: like --debug; or 'skip' to skip stages 1-2.",
    )
    parser.add_argument(
        "--debug3",
        type=str,
        default=None,
        choices=arg_helper("debug3"),
        help="Debug level override for stage 3: like --debug.",
    )
    parser.add_argument(
        "--debug4",
        type=str,
        default=None,
        choices=arg_helper("debug4"),
        help="Debug level override for stage 4: like --debug; or 'nice' to print answer only.",
    )

    return parser


def fill_in_debug_defaults(args: argparse.Namespace) -> None:
    # In batch mode, defaults are diff, diff, diff, diff.
    # In interactive mode they are none, none, none, nice.
    if args.batch:
        args.debug = args.debug or "diff"
    args.debug1 = args.debug1 or args.debug or "none"
    args.debug2 = args.debug2 or args.debug or "none"
    args.debug3 = args.debug3 or args.debug or "none"
    args.debug4 = args.debug4 or args.debug or "nice"
    if args.debug2 == "skip":
        args.debug1 = "skip"  # Skipping stage 2 implies skipping stage 1.


def load_podcast_index(podcast_file: str) -> query.QueryEvalContext:
    settings = importing.ConversationSettings()
    with utils.timelog(f"load podcast from {podcast_file!r}"):
        conversation = podcast.Podcast.read_from_file(podcast_file, settings)
    assert conversation is not None, f"Failed to load podcast from {podcast_file!r}"
    return query.QueryEvalContext(conversation)


def load_index_file(file: str, selector: str) -> dict[str, dict[str, object]]:
    # If this crashes, the file is malformed -- go figure it out.
    try:
        with open(file) as f:
            data = json.load(f)
    except FileNotFoundError as err:
        print(Fore.RED + str(err), file=sys.stderr)
        sys.exit(1)
    res = {item[selector]: item for item in data}
    if len(res) != len(data):
        # TODO: What else to do? Use 'cmd' as key?
        print(
            Fore.YELLOW
            + f"{len(data) - len(res)} duplicate items found in {file!r}. "
            + Fore.RESET
        )
    return res


async def compare_answers(
    context: ProcessingContext,
    expected: tuple[str, bool],
    actual: tuple[str, bool],
    message: str,
) -> float:
    expected_text, expected_success = expected
    actual_answer, actual_success = actual

    if expected_success != actual_success:
        print(
            Fore.RED
            + f"Success mismatch {expected_success}, {actual_success}"
            + Fore.RESET
        )
        return 0.000

    if not actual_success:
        print(Fore.GREEN + f"Both failed" + Fore.RESET)
        return 1.001

    if expected_text == actual_answer:
        print(Fore.GREEN + f"Both equal" + Fore.RESET)
        return 1.000

    # if expected_text.lower() == actual_answer.lower():
    #     print(Fore.GREEN + f"{message}: Both equal except case" + Fore.RESET)
    #     return 0.999

    print(f"Answer mismatch")
    diff = difflib.unified_diff(
        expected_text.splitlines(),
        actual_answer.splitlines(),
        fromfile="expected",
        tofile="actual",
        n=1000000000,  # Show all lines in the diff
    )
    for x in diff:
        if x.startswith("-"):
            print(Fore.RED + x.rstrip("\n") + Fore.RESET)
        elif x.startswith("+"):
            print(Fore.GREEN + x.rstrip("\n") + Fore.RESET)
        else:
            print(x.rstrip("\n"))
    return await equality_score(context, expected_text, actual_answer)


async def equality_score(context: ProcessingContext, a: str, b: str) -> float:
    if a == b:
        return 1.0
    if a.lower() == b.lower():
        return 0.999
    embeddings = await context.embedding_model.get_embeddings([a, b])
    assert embeddings.shape[0] == 2, "Expected two embeddings"
    return np.dot(embeddings[0], embeddings[1])


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        print()
        sys.exit(1)
