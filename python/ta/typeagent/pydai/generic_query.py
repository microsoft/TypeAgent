#!/usr/bin/env python3
"""
Generic Query Conversion using Schem- time_range structure: {{"start_date": {{"date": {{"day": 1, "month": 5, "year": 2023}}, "time": {{"hour": 0, "minute": 0, "seconds": 0}}}}, "stop_date": {{"date": {{"day": 1, "month": 5, "year": 2023}}, "time": {{"hour": 0, "minute": 15, "seconds": 0}}}}}}-Driven Approach

This approach relies entirely on the Pydantic schema descriptions to guide
the LLM, similar to TypeChat. No dynamic examples or few-shot learning.
The schema descriptions in search_query_schema.py provide all the guidance needed.
"""

import asyncio
import json
import sys
from os import getenv

from dotenv import load_dotenv
import logfire
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.azure import AzureProvider

import typechat

from typeagent.aitools.auth import get_shared_token_provider

from .prompts import BIG_PROMPT
from .search_query_schema import SearchQuery


def scrubbing_callback(m: logfire.ScrubMatch):
    # if m.path == ('attributes', 'http.request.header.authorization'):
    #     return m.value

    # if m.path == ('attributes', 'http.request.header.api-key'):
    #     return m.value

    if (
        m.path == ('attributes', 'http.request.body.text', 'messages', 0, 'content')
        and m.pattern_match.group(0) == 'secret'
    ):
        return m.value

    # if m.path == ('attributes', 'http.response.header.azureml-model-session'):
    #     return m.value

logfire.configure(scrubbing=logfire.ScrubbingOptions(callback=scrubbing_callback))

logfire.instrument_pydantic_ai()
logfire.instrument_httpx(capture_all=True)


def make_agent() -> Agent[None, SearchQuery]:
    """Create agent with schema-driven approach."""
    openai_api_key = getenv("OPENAI_API_KEY")
    azure_openai_api_key = getenv("AZURE_OPENAI_API_KEY")
    if openai_api_key:
        model = OpenAIModel("gpt-4o")
    elif azure_openai_api_key:
        if azure_openai_api_key == "identity":
            token_provider = get_shared_token_provider()
            azure_openai_api_key = token_provider.get_token()
        model = OpenAIModel(
            "gpt-4o",
            provider=AzureProvider(
                azure_endpoint=getenv("AZURE_OPENAI_ENDPOINT"),
                api_version="2024-08-01-preview",
                api_key=azure_openai_api_key,
            ),
        )
    else:
        raise RuntimeError(
            "Neither OPENAI_API_KEY nor AZURE_OPENAI_API_KEY was provided."
        )

    return Agent(model, output_type=SearchQuery)


async def query_generic(
    question: str, prompt_preamble: list[typechat.PromptSection] | None = None
) -> SearchQuery:
    """Convert question to SearchQuery using an LLM."""
    agent = make_agent()

    texts = []
    if prompt_preamble:
        for section in prompt_preamble:
            if section["role"] == "system":
                # For now, we assume there is only one system prompt.
                # The new prompt is BIG_PROMPT.
                pass
            else:
                texts.append(section["content"])
    texts.append(question)
    prompt = BIG_PROMPT + "\n\nUser question: " + " ".join(texts)

    # print(prompt)
    retries = 3
    for i in range(retries):
        try:
            result = await agent.run(prompt)
            # print(result.usage())
            return result.output
        except Exception as e:
            print(f"### Attempt {i + 1} failed: {e}")
            if i + 1 == retries:
                raise


def main() -> None:
    """Main function to test the generic query converter."""
    # Get query from command line argument or use default
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
    else:
        query = "List all books"

    print(f"# Testing '{query}' (Generic Schema-Driven) #")
    result = asyncio.run(query_generic(query))

    # Format for comparison
    search_exprs = result.model_dump()["search_expressions"]
    formatted = {"searchExpressions": search_exprs}

    print("## Formatted result ##")
    print(json.dumps(formatted, indent=2))


if __name__ == "__main__":
    load_dotenv("../../ts/.env")
    main()
