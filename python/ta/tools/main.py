# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import asyncio
from dataclasses import dataclass
import json
import sys
import typing

from colorama import init as colorama_init, Fore
import typechat

from typeagent.demo.ui import print_result
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
class ProcessingContext[TMessage: IMessage, TIndex: ITermToSemanticRefIndex]:
    query_context: query.QueryEvalContext[TMessage, TIndex]
    qa_index: dict[str, dict[str, object]]
    sr_index: dict[str, dict[str, object]]
    debug1: typing.Literal["none", "diff", "full", "skip"]
    debug2: typing.Literal["none", "diff", "full", "skip"]
    debug3: typing.Literal["none", "diff", "full"]
    debug4: typing.Literal["none", "diff", "full", "nice"]
    query_translator: typechat.TypeChatJsonTranslator[search_query_schema.SearchQuery]
    answer_translator: typechat.TypeChatJsonTranslator[
        answer_response_schema.AnswerResponse
    ]
    lang_search_options: searchlang.LanguageSearchOptions
    answer_context_options: answers.AnswerContextOptions

    def __repr__(self) -> str:
        args = []
        args.append(f"qa_index={len(self.qa_index)}")
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
    qa_index = load_index_file(args.qafile, "question")
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
        qa_index,
        sr_index,
        args.debug1,
        args.debug2,
        args.debug3,
        args.debug4,
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


def interactive_loop(context: ProcessingContext) -> None:
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


async def process_query(context: ProcessingContext, query_text: str) -> None:
    debug_context = searchlang.LanguageSearchDebugContext()
    if context.debug1 == "skip" or context.debug2 == "skip":
        if query_text in context.sr_index:
            debug_context.use_search_query = serialization.deserialize_object(
                search_query_schema.SearchQuery, context.sr_index[query_text]
            )
        if context.debug2 == "skip":
            debug_context.use_compiled_search_query_exprs = (
                serialization.deserialize_object(
                    list[search.SearchQueryExpr],
                    context.sr_index[query_text]["compiledQueryExpr"],
                )
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

    if context.debug1 == "full":
        print("Stage 1 results:")
        utils.pretty_print(debug_context.search_query, Fore.GREEN, Fore.RESET)
    if context.debug2 == "full":
        print("Stage 2 results:")
        utils.pretty_print(
            debug_context.search_query_expr, Fore.GREEN, Fore.RESET
        )
    if context.debug3 == "full":
        print("Stage 3 results:")
        utils.pretty_print(
            result.value, Fore.GREEN, Fore.RESET
        )
    search_results = result.value
    if context.debug3 == "full":
        for sr in search_results:
            print_result(sr, context.query_context.conversation)
            print("-" * 50)
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
    helper = lambda key: typing.get_args(ProcessingContext.__annotations__[key])
    parser.add_argument(
        "--debug1",
        type=str,
        default=None,
        choices=helper("debug1"),
        help="Debug level override for stage 1: like --debug; or 'skip' to skip stage 1.",
    )
    parser.add_argument(
        "--debug2",
        type=str,
        default=None,
        choices=helper("debug2"),
        help="Debug level override for stage 2: like --debug; or 'skip' to skip stages 1-2.",
    )
    parser.add_argument(
        "--debug3",
        type=str,
        default=None,
        choices=helper("debug3"),
        help="Debug level override for stage 3: like --debug.",
    )
    parser.add_argument(
        "--debug4",
        type=str,
        default=None,
        choices=helper("debug4"),
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
        print(Fore.YELLOW + f"{len(data) - len(res)} duplicate items found in {file!r}. " + Fore.RESET)
    return res


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        sys.exit(1)
