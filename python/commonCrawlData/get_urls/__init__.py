# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import json
import logging

import requests
from crawl_limits import (
    DEFAULT_CRAWL_ID,
    DEFAULT_INDEX_LIMIT,
    CrawlValidationError,
    validate_search_params,
)


INDEX_TIMEOUT = (5, 30)


def main(params: str) -> list:
    """Activity function to get URLs from Common Crawl"""
    try:
        if isinstance(params, str):
            params = json.loads(params)
        if not isinstance(params, dict):
            raise CrawlValidationError("Index input must be an object")
    except (ValueError, RecursionError) as exc:
        logging.error("Invalid Common Crawl index input: expected an object")
        raise CrawlValidationError(
            "Index input must be an object or JSON object"
        ) from exc
    return get_urls(
        params.get("limit", DEFAULT_INDEX_LIMIT),
        params.get("crawl_id", DEFAULT_CRAWL_ID),
        params.get("url_prefix", ""),
    )


def get_urls(limit, crawl_id, url_prefix):
    """Query Common Crawl index for restaurant URLs"""
    try:
        params = validate_search_params(
            {"limit": limit, "crawl_id": crawl_id, "url_prefix": url_prefix}
        )
        limit = params["limit"]
        cc_index_url = f"https://index.commoncrawl.org/CC-MAIN-{crawl_id}-index"
        with requests.get(
            cc_index_url,
            params={"url": f"{url_prefix}*", "output": "json", "limit": limit},
            timeout=INDEX_TIMEOUT,
            stream=True,
        ) as response:
            if response.status_code != 200:
                logging.error("Error querying index: %s", response.status_code)
                return []
            records = []
            for line in response.iter_lines():
                if not line.strip():
                    continue
                if len(records) == limit:
                    raise CrawlValidationError(
                        f"Index returned more records than the requested limit of {limit}"
                    )
                try:
                    record = json.loads(line)
                except (ValueError, RecursionError) as exc:
                    raise CrawlValidationError(
                        "Invalid JSON record in index response"
                    ) from exc
                if not isinstance(record, dict):
                    raise CrawlValidationError("Index records must be objects")
                records.append(record)
        logging.info("Found %s matching URLs", len(records))
        return records
    except (CrawlValidationError, requests.exceptions.RequestException) as exc:
        logging.error("Common Crawl index request failed: %.200s", exc)
        raise
