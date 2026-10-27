# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import re


DEFAULT_LIMIT = 1000
DEFAULT_BATCH_SIZE = 50
DEFAULT_INDEX_LIMIT = 100
DEFAULT_CRAWL_ID = "2025-13"
MAX_URLS = 1000
MAX_BATCH_SIZE = 50
MAX_IN_FLIGHT_ACTIVITIES = 4
MAX_BATCHES = MAX_URLS
MAX_ACTIVITY_CALLS = 2 * MAX_BATCHES + 2


class CrawlValidationError(ValueError):
    """Invalid crawl input or an activity result outside the crawl budget."""


def bounded_positive_integer(value, name, maximum):
    message = f"{name} must be an integer between 1 and {maximum}"
    if type(value) is int:
        number = value
    elif isinstance(value, str):
        value = value.strip()
        if not re.fullmatch(r"[+-]?[0-9]+", value) or value.startswith("-"):
            raise CrawlValidationError(message)
        digits = value.lstrip("+").lstrip("0") or "0"
        ceiling = str(maximum)
        if len(digits) > len(ceiling) or (
            len(digits) == len(ceiling) and digits > ceiling
        ):
            raise CrawlValidationError(message)
        number = int(digits)
    else:
        raise CrawlValidationError(message)
    if not 1 <= number <= maximum:
        raise CrawlValidationError(message)
    return number


def validate_search_params(params, default_limit=DEFAULT_LIMIT):
    if not isinstance(params, dict):
        raise CrawlValidationError("Crawl input must be an object")
    limit = bounded_positive_integer(
        params.get("limit", default_limit), "limit", MAX_URLS
    )
    url_prefix = params.get("url_prefix")
    if not isinstance(url_prefix, str) or not url_prefix.strip():
        raise CrawlValidationError("url_prefix must be a nonempty string")
    crawl_id = params.get("crawl_id", DEFAULT_CRAWL_ID)
    if (
        not isinstance(crawl_id, str)
        or not crawl_id
        or any(
            not char.isprintable() or char.isspace() or char in "/\\?#&%"
            for char in crawl_id
        )
    ):
        raise CrawlValidationError(
            "crawl_id must be a nonempty string without whitespace or URL delimiters"
        )
    return {"limit": limit, "crawl_id": crawl_id, "url_prefix": url_prefix}


def validate_crawl_params(params):
    validated = validate_search_params(params)
    validated["batch_size"] = bounded_positive_integer(
        params.get("batch_size", DEFAULT_BATCH_SIZE), "batch_size", MAX_BATCH_SIZE
    )
    return validated
