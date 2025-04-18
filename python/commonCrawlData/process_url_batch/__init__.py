# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
import azure.functions as func
import json
import re
import requests
import gzip
import io
from warcio.archiveiterator import ArchiveIterator
import extruct
from w3lib.html import get_base_url
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib.parse import urlparse
import time
from datetime import datetime, timedelta
import random

dns_failures = 0
dns_failure_threshold = 5
circuit_breaker_active = False
circuit_breaker_reset_time = None


def main(params: str) -> dict:
    """Activity function to process a batch of restaurant URLs"""
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError:
            params = {}

    batch = params.get("batch", [])
    batch_number = params.get("batch_number", 0)
    total_batches = params.get("total_batches", 0)

    logging.info(
        f"Processing batch {batch_number}/{total_batches} with {len(batch)} URLs"
    )

    results = process_urls(batch)
    return {
        "batch_number": batch_number,
        "total_urls": len(batch),
        "results": results,
        "extracted_count": len(results),
    }


def download_and_extract_warc(warc_record, redirect_handled=False):
    """Download and extract content from a WARC record with robust retry logic and single redirect follow."""
    offset, length = int(warc_record["offset"]), int(warc_record["length"])
    warc_filename = warc_record["filename"]

    session = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))

    headers = {
        "Range": f"bytes={offset}-{offset+length-1}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }

    url = f"https://data.commoncrawl.org/{warc_filename}"

    for attempt in range(3):
        try:
            logging.info(f"Attempt {attempt+1} downloading from: {url}")
            response = session.get(url, headers=headers, timeout=30)

            if response.status_code != 206:
                logging.warning(f"Got status code {response.status_code} from {url}")
                break

            warc_content = io.BytesIO(response.content)
            for record in ArchiveIterator(warc_content):
                if record.rec_type != "response":
                    continue

                status = record.http_headers.get_statuscode()
                target_uri = record.rec_headers.get_header("WARC-Target-URI")
                content_type = record.http_headers.get_header(
                    "Content-Type", ""
                ).lower()

                if status in ["301", "302"] and not redirect_handled:
                    logging.info(f"Received a redirect request for: {target_uri}")
                    logging.info(f"HTTP status: {status}")
                    logging.info(f"Content-Type: {content_type}")

                    location = record.http_headers.get_header("Location")
                    if location:
                        if location.startswith("/"):
                            parsed_url = urlparse(target_uri)
                            location = (
                                f"{parsed_url.scheme}://{parsed_url.netloc}location"
                            )
                        if location.startswith("http://"):
                            location = location.replace("http://", "https://", 1)

                        logging.info(f"Following redirect to: {location}")
                        # delay between 301 and redirect lookup
                        time.sleep(random.uniform(0.5, 1.5))
                        redirected = lookup_redirected_warc(location)
                        if redirected:
                            return download_and_extract_warc(
                                redirected, redirect_handled=True
                            )
                        else:
                            logging.warning("Redirected WARC not found.")
                    continue

                if "html" not in content_type:
                    logging.info("Skipping non-HTML content.")
                    continue

                raw_stream = record.content_stream().read()
                if not raw_stream:
                    logging.warning("Record content stream is empty.")
                    continue

                if record.http_headers.get_header("Content-Encoding") == "gzip":
                    try:
                        raw_stream = gzip.decompress(raw_stream)
                    except Exception as e:
                        logging.warning(f"Failed to decompress: {e}")
                        continue

                try:
                    html_content = raw_stream.decode("utf-8", errors="replace")
                    return html_content
                except Exception as e:
                    logging.warning(f"Failed to decode: {e}")
                    continue

            break  # Break out of retry loop if successful

        except requests.exceptions.ConnectionError as e:
            if "NameResolutionError" in str(e):
                wait_time = (2**attempt) * 2
                logging.warning(f"DNS resolution error. Retrying in {wait_time}s: {e}")
                time.sleep(wait_time)
            else:
                logging.error(f"Connection error: {e}")
                break
        except Exception as e:
            logging.error(f"Unexpected error: {e}")
            break

    logging.error("Failed to download WARC after retries.")
    return None


def lookup_redirected_warc(url, crawl_id="2025-13"):
    cc_index_url = (
        f"https://index.commoncrawl.org/CC-MAIN-{crawl_id}-index?url={url}&output=json"
    )

    for attempt in range(5):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            }
            response = requests.get(cc_index_url, timeout=10, headers=headers)
            if response.status_code == 200:
                results = [
                    json.loads(line) for line in response.text.strip().splitlines()
                ]
                if results:
                    return results[0]
                else:
                    logging.warning(f"No WARC record found for redirected URL: {url}")
                    return None
            elif response.status_code == 503:
                wait = 2**attempt + random.uniform(0, 1)
                logging.warning(
                    f"503 Service Unavailable for index lookup. Waiting {wait:.1f}s before retry."
                )
                time.sleep(wait)
            else:
                logging.warning(
                    f"Unexpected status {response.status_code} from index lookup for {url}"
                )
                return None
        except Exception as e:
            logging.error(f"Error looking up WARC for redirected URL {url}: {e}")
            time.sleep(2**attempt)
    logging.error(
        f"Failed to retrieve WARC record after retries for redirected URL: {url}"
    )
    return None


def correct_swapped_address_fields(address):
    """
    Corrects swapped postalCode and addressCountry fields in a schema.org address object.
    """
    if not isinstance(address, dict):
        return address

    postal_code = address.get("postalCode")
    address_country = address.get("addressCountry")

    if postal_code and address_country:
        address["postalCode"], address["addressCountry"] = address_country, postal_code

    return address


def extract_schema_data(html, url):
    """Extract schema.org data from HTML"""
    if not html:
        return None

    # Get base URL for potential relative URL resolution
    base_url = get_base_url(html, url)

    # Extract all structured data (JSON-LD, Microdata, RDFa, etc.)
    data = extruct.extract(
        html, base_url=base_url, syntaxes=["json-ld", "microdata", "rdfa"]
    )

    # Find restaurant schema data (look in json-ld first as it's most common)
    restaurant_data = None

    # Check JSON-LD format first (most common for schema.org)
    for item in data.get("json-ld", []):
        item_type = item.get("@type", "")
        if isinstance(item_type, list):
            types = item_type
        else:
            types = [item_type]

        if any(
            t in ["Restaurant", "FoodEstablishment", "LocalBusiness"] for t in types
        ):
            restaurant_data = item
            break

    # If not found in JSON-LD, check microdata
    if not restaurant_data:
        for item in data.get("microdata", []):
            item_type = item.get("type", "")
            if isinstance(item_type, list):
                types = item_type
            else:
                types = [item_type]

            if any(
                t.endswith("Restaurant") or t.endswith("FoodEstablishment")
                for t in types
            ):
                restaurant_data = item
                break

    # Finally check RDFa if needed
    if not restaurant_data:
        for item in data.get("rdfa", []):
            item_type = item.get("type", "")
            if isinstance(item_type, list):
                types = item_type
            else:
                types = [item_type]

            if any(
                t.endswith("Restaurant") or t.endswith("FoodEstablishment")
                for t in types
            ):
                restaurant_data = item
                break

    if restaurant_data and url.startswith("https://www.opentable.com"):
        # fix bug in opentable address data
        address = restaurant_data.get("address", {})
        restaurant_data["address"] = correct_swapped_address_fields(address)

    return restaurant_data


def check_circuit_breaker():
    global circuit_breaker_active, circuit_breaker_reset_time, dns_failures

    # If circuit breaker is active, check if enough time has passed to reset it
    if circuit_breaker_active:
        if circuit_breaker_reset_time and datetime.now() > circuit_breaker_reset_time:
            logging.info("Circuit breaker reset. Resuming normal operation.")
            circuit_breaker_active = False
            dns_failures = 0
            return False
        return True

    # Check if we've hit the threshold
    if dns_failures >= dns_failure_threshold:
        logging.warning(f"Circuit breaker activated after {dns_failures} DNS failures")
        circuit_breaker_active = True
        circuit_breaker_reset_time = datetime.now() + timedelta(minutes=5)
        return True

    return False


def process_urls(urls):
    """Process a batch of URLs and extract schema.org data"""
    results = []

    for i, record in enumerate(urls):
        if check_circuit_breaker():
            logging.warning("Circuit breaker active. Pausing processing.")
            break
        try:
            url = record["url"]
            logging.info(f"Processing {i+1}/{len(urls)}: {url}")

            # Download and extract HTML content
            html = download_and_extract_warc(record)
            if not html:
                logging.warning("  Failed to extract HTML")
                continue

            # Extract schema.org data
            schema_data = extract_schema_data(html, url)
            if schema_data:
                # Add the source URL to the data
                schema_data["_source_url"] = url
                results.append(schema_data)
                logging.info(f"  Successfully extracted schema data")
            else:
                logging.info("  No restaurant schema data found")
        except requests.exceptions.ConnectionError as e:
            if "NameResolutionError" in str(e):
                global dns_failures
                dns_failures += 1
                logging.warning(f"DNS failure count: {dns_failures}")

    logging.info(f"Extracted schema data for {len(results)} restaurants")
    return results
