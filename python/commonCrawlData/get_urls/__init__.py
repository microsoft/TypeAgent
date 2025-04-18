# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
import azure.functions as func
import json
import requests


def main(params: str) -> list:
    """Activity function to get URLs from Common Crawl"""
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError:
            params = {}

    limit = params.get("limit", 100)
    crawl_id = params.get("crawl_id", "2025-13")
    url_prefix = params.get("url_prefix", "")

    if not url_prefix:
        return {"status": "error", "message": "No URL search query provided"}

    logging.info(f"Getting up to {limit} URLs from crawl {crawl_id}")
    return get_urls(limit, crawl_id, url_prefix)


def get_urls(limit, crawl_id, url_prefix):
    """Query Common Crawl index for restaurant URLs"""
    # Common Crawl index URL pattern
    cc_index_url = f"https://index.commoncrawl.org/CC-MAIN-{crawl_id}-index"
    query = f"{url_prefix}*"

    logging.info(f"Querying Common Crawl index: {cc_index_url}")
    logging.info(f"Query: {query}")

    response = requests.get(
        cc_index_url + "?" + "url=" + query + "&output=json&limit=" + str(limit)
    )

    if response.status_code != 200:
        logging.error(f"Error querying index: {response.status_code}")
        return []

    cc_data = [json.loads(line) for line in response.text.strip().split("\n")]
    logging.info(f"Found {len(cc_data)} matching URLs")

    return cc_data
