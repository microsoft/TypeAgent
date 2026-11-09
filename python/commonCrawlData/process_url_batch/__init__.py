# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
import azure.functions as func
import json
import re
import requests
import zlib
import io
from warcio.exceptions import ArchiveLoadFailed
from warcio.recordloader import ArcWarcRecordLoader
from warcio.statusandheaders import StatusAndHeadersParserException
import extruct
from w3lib.html import get_base_url
from urllib3.exceptions import HTTPError as Urllib3HTTPError
from urllib.parse import urljoin, urlparse
import time
from datetime import datetime, timedelta
import random

MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024
MAX_WARC_BYTES = 16 * 1024 * 1024
MAX_HTML_BYTES = 8 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024

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


class RecordRejected(Exception):
    """An invalid or oversized archive record that should not be retried."""


class _CrawlSession(requests.Session):
    def resolve_redirects(self, *args, **kwargs):
        # Session can consume a redirect body to prepare Response.next even
        # with allow_redirects=False.
        return iter(())


def _integer(value, name):
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        try:
            return int(value)
        except ValueError:
            pass
    raise RecordRejected(f"Invalid {name}")


def _is_http_url(value):
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        return False
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except ValueError:
        return False


def _validate_warc_record(record):
    if not isinstance(record, dict):
        raise RecordRejected("Index record must be an object")
    filename = record.get("filename")
    if (
        not isinstance(filename, str)
        or not filename
        or any(ord(c) <= 32 or ord(c) == 127 for c in filename)
        or any(c in filename for c in ("\\", "?", "#", ":"))
        or any(part in ("", ".", "..") for part in filename.split("/"))
    ):
        raise RecordRejected("Invalid archive filename")
    offset = _integer(record.get("offset"), "archive offset")
    length = _integer(record.get("length"), "archive length")
    if offset < 0 or not 0 < length <= MAX_DOWNLOAD_BYTES:
        raise RecordRejected("Archive range is outside the download budget")
    return offset, length, filename


def _request(session, url, headers, timeout, params=None, index_lookup=False):
    attempts = 5 if index_lookup else 6
    retry_statuses = (503,) if index_lookup else (500, 502, 503, 504)
    for attempt in range(attempts):
        try:
            response = session.get(
                url,
                headers=headers,
                params=params,
                timeout=timeout,
                stream=True,
                allow_redirects=False,
            )
        except requests.exceptions.RequestException as exc:
            if not index_lookup and not isinstance(
                exc, requests.exceptions.ConnectionError
            ):
                raise
            dns_error = "NameResolutionError" in str(exc)
            if attempt == attempts - 1 or (
                not index_lookup and dns_error and attempt >= 2
            ):
                raise
            delay = 2**attempt
            if not index_lookup:
                delay = delay * 2 if dns_error else (0 if attempt == 0 else delay)
            logging.warning(
                "Retrying Common Crawl request after transport failure: %.200s", exc
            )
        else:
            if response.status_code not in retry_statuses or attempt == attempts - 1:
                return response
            response.close()
            delay = (
                2**attempt + random.uniform(0, 1)
                if index_lookup else (0 if attempt == 0 else 2**attempt)
            )
            logging.warning(
                "Retrying Common Crawl HTTP status %s", response.status_code
            )
        if delay:
            time.sleep(delay)


def _bounded_chunks(read, limit):
    count = 0
    while True:
        chunk = read(min(READ_CHUNK_BYTES, limit - count + 1))
        if not chunk:
            return
        count += len(chunk)
        if count > limit:
            raise RecordRejected("Response or payload exceeds its byte budget")
        yield chunk


def _check_response(response, expected_status, limit, offset=None):
    if response.status_code != expected_status:
        raise RecordRejected(f"Unexpected HTTP status {response.status_code}")
    encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
    if encoding != "identity":
        raise RecordRejected("Unexpected transport content encoding")
    declared = response.headers.get("Content-Length")
    if declared is not None:
        declared = _integer(declared, "response Content-Length")
        if (
            declared < 0
            or declared > limit
            or (offset is not None and declared != limit)
        ):
            raise RecordRejected(
                "Response Content-Length does not match the budget or range"
            )
    content_range = response.headers.get("Content-Range")
    if offset is not None and content_range is not None:
        match = re.fullmatch(r"bytes ([0-9]+)-([0-9]+)/([0-9]+|\*)", content_range)
        if not match:
            raise RecordRejected("Invalid response Content-Range")
        start, end = (_integer(value, "Content-Range") for value in match.groups()[:2])
        total = match.group(3)
        if (
            start != offset
            or end != offset + limit - 1
            or (total != "*" and _integer(total, "Content-Range total") <= end)
        ):
            raise RecordRejected(
                "Response Content-Range does not match the requested range"
            )


def _decompress(data, limit, wbits, multiple_members=False):
    output = bytearray()
    decoder = zlib.decompressobj(wbits)
    pending = b""
    position = 0
    try:
        while True:
            if not pending and position < len(data):
                pending = data[position : position + READ_CHUNK_BYTES]
                position += len(pending)
            chunk = decoder.decompress(
                pending, min(READ_CHUNK_BYTES, limit - len(output) + 1)
            )
            if len(output) + len(chunk) > limit:
                raise RecordRejected("Decompressed content exceeds its byte budget")
            output.extend(chunk)
            if decoder.eof:
                pending = decoder.unused_data
                if not pending and position == len(data):
                    return bytes(output)
                if not multiple_members:
                    raise RecordRejected("Trailing data after deflate stream")
                decoder = zlib.decompressobj(wbits)
                continue
            pending = decoder.unconsumed_tail
            if not pending and position == len(data) and not chunk:
                raise RecordRejected("Truncated compressed stream")
    except zlib.error as exc:
        raise RecordRejected("Malformed compressed stream") from exc


def _codings(headers, name):
    values = [
        coding.strip().lower()
        for key, value in headers.headers
        if key.lower() == name
        for coding in value.split(",")
    ]
    if any(not value for value in values):
        raise RecordRejected(f"Invalid {name}")
    return values


def _unchunk(data, limit):
    output = bytearray()
    with io.BytesIO(data) as stream:
        while True:
            line = stream.readline()
            size_text = line[:-2].split(b";", 1)[0]
            if (
                not line.endswith(b"\r\n")
                or b"\r" in line[:-2]
                or b"\n" in line[:-2]
                or not re.fullmatch(b"[0-9a-fA-F]+", size_text)
            ):
                raise RecordRejected("Invalid HTTP chunk size")
            try:
                size = int(size_text, 16)
            except ValueError as exc:
                raise RecordRejected("Invalid HTTP chunk size") from exc
            if size == 0:
                while True:
                    trailer = stream.readline()
                    if trailer == b"\r\n":
                        break
                    if (
                        not trailer.endswith(b"\r\n")
                        or b"\r" in trailer[:-2]
                        or b"\n" in trailer[:-2]
                        or not re.match(rb"[!#$%&'*+\-.^_`|~0-9A-Za-z]+:", trailer)
                    ):
                        raise RecordRejected("Invalid HTTP chunk trailer")
                if stream.tell() != len(data):
                    raise RecordRejected("Trailing data after HTTP chunks")
                return bytes(output)
            if size > len(data) - stream.tell() - 2:
                raise RecordRejected("Truncated HTTP chunk")
            if size > limit - len(output):
                raise RecordRejected("Decoded chunked body exceeds its byte budget")
            for start in range(0, size, READ_CHUNK_BYTES):
                output.extend(stream.read(min(READ_CHUNK_BYTES, size - start)))
            if stream.read(2) != b"\r\n":
                raise RecordRejected("Invalid HTTP chunk separator")


def _decode_html(payload, headers):
    content = _codings(headers, "content-encoding")
    if content not in ([], ["identity"], ["gzip"], ["x-gzip"], ["deflate"]):
        raise RecordRejected("Unsupported or repeated HTTP content encoding")
    identity = not content or content == ["identity"]
    transfer = _codings(headers, "transfer-encoding")
    if transfer:
        if transfer != ["chunked"]:
            raise RecordRejected("Unsupported HTTP transfer encoding")
        payload = _unchunk(payload, MAX_HTML_BYTES if identity else MAX_WARC_BYTES)
    if identity:
        if len(payload) > MAX_HTML_BYTES:
            raise RecordRejected("HTML exceeds its byte budget")
        return payload
    if content in (["gzip"], ["x-gzip"]):
        return _decompress(payload, MAX_HTML_BYTES, 16 + zlib.MAX_WBITS, True)
    wrapped = (
        len(payload) >= 2
        and payload[0] & 15 == 8
        and payload[0] >> 4 <= 7
        and int.from_bytes(payload[:2], "big") % 31 == 0
    )
    return _decompress(
        payload, MAX_HTML_BYTES, zlib.MAX_WBITS if wrapped else -zlib.MAX_WBITS
    )


def _extract_warc(data, redirect_handled):
    if data.startswith(b"\x1f\x8b"):
        data = _decompress(data, MAX_WARC_BYTES, 16 + zlib.MAX_WBITS, True)
    if len(data) > MAX_WARC_BYTES:
        raise RecordRejected("WARC exceeds its byte budget")
    version = data.split(b"\n", 1)[0].rstrip(b"\r")
    if version not in [
        value.encode("ascii") for value in ArcWarcRecordLoader.WARC_TYPES
    ]:
        raise RecordRejected("Expected an uncompressed WARC record")
    loader = ArcWarcRecordLoader(verify_http=True, arc2warc=False)
    stream = io.BytesIO(data)
    result = None
    try:
        while stream.tell() < len(data):
            record = loader.parse_record_stream(
                stream, no_record_parse=True, known_format="warc"
            )
            lengths = [
                value
                for key, value in record.rec_headers.headers
                if key.lower() == "content-length"
            ]
            if len(lengths) != 1:
                raise RecordRejected("Missing or repeated WARC Content-Length")
            length = _integer(lengths[0], "WARC Content-Length")
            body_end = stream.tell() + length
            if (
                not 0 <= length <= MAX_WARC_BYTES
                or data[body_end : body_end + 4] != b"\r\n\r\n"
            ):
                raise RecordRejected("Invalid WARC length or record boundary")
            if record.rec_type != "response":
                stream.seek(body_end + 4)
                continue
            target = record.rec_headers.get_header("WARC-Target-URI")
            if not length or not _is_http_url(target):
                raise RecordRejected("Invalid WARC length or target URI")
            start = record.raw_stream.tell()
            headers = loader.load_http_headers(
                record.rec_type, target, record.raw_stream, length
            )
            if headers is None or not data[stream.tell() - 4 : stream.tell()].endswith(
                (b"\r\n\r\n", b"\n\n")
            ):
                raise RecordRejected("Missing or incomplete archived HTTP headers")
            payload_length = length - (record.raw_stream.tell() - start)
            if payload_length < 0:
                raise RecordRejected("Invalid archived HTTP payload length")
            transfer = _codings(headers, "transfer-encoding")
            if not transfer:
                declared_lengths = [
                    value
                    for key, value in headers.headers
                    if key.lower() == "content-length"
                ]
                if len(declared_lengths) > 1 or (
                    declared_lengths
                    and _integer(declared_lengths[0], "HTTP Content-Length")
                    != payload_length
                ):
                    raise RecordRejected(
                        "Archived HTTP Content-Length does not match payload"
                    )
            if result is not None:
                stream.seek(body_end + 4)
                continue
            status = headers.get_statuscode()
            if status in ("301", "302") and not redirect_handled:
                location = headers.get_header("Location")
                if location:
                    try:
                        location = urljoin(target, location)
                    except ValueError as exc:
                        raise RecordRejected("Invalid archived redirect URL") from exc
                    if not _is_http_url(location):
                        raise RecordRejected("Invalid archived redirect URL")
                    if location.startswith("http://"):
                        location = "https://" + location[len("http://") :]
                    result = None, location
                stream.seek(body_end + 4)
                continue
            if "html" not in headers.get_header("Content-Type", "").lower():
                stream.seek(body_end + 4)
                continue
            if (
                not transfer
                and _codings(headers, "content-encoding") in ([], ["identity"])
                and payload_length > MAX_HTML_BYTES
            ):
                raise RecordRejected("HTML exceeds its byte budget")
            payload = b"".join(_bounded_chunks(record.raw_stream.read, payload_length))
            if len(payload) != payload_length:
                raise RecordRejected("Truncated archived HTTP payload")
            stream.seek(body_end + 4)
            html = _decode_html(payload, headers)
            if html:
                result = html.decode("utf-8", errors="replace"), None
        if result is not None:
            return result
        raise RecordRejected("No non-empty HTML response in archive")
    except (ArchiveLoadFailed, StatusAndHeadersParserException, EOFError) as exc:
        raise RecordRejected("Malformed WARC or HTTP headers") from exc
    finally:
        stream.close()


def download_and_extract_warc(warc_record, redirect_handled=False):
    """Extract one bounded archive record, following at most one archived redirect."""
    try:
        offset, length, filename = _validate_warc_record(warc_record)
        headers = {
            "Range": f"bytes={offset}-{offset + length - 1}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Encoding": "identity",
        }
        with _CrawlSession() as session:
            with _request(
                session, f"https://data.commoncrawl.org/{filename}", headers, 30
            ) as response:
                _check_response(response, 206, length, offset)
                data = b"".join(
                    _bounded_chunks(
                        lambda size: response.raw.read(size, decode_content=False),
                        length,
                    )
                )
                if len(data) != length:
                    raise RecordRejected("Truncated archive download")
        html, location = _extract_warc(data, redirect_handled)
        if location:
            time.sleep(random.uniform(0.5, 1.5))
            redirected = lookup_redirected_warc(location)
            if redirected:
                return download_and_extract_warc(redirected, redirect_handled=True)
            raise RecordRejected("Redirected archive record not found")
        return html
    except RecordRejected as exc:
        logging.warning("Rejected Common Crawl record: %.200s", exc)
    except (requests.exceptions.RequestException, Urllib3HTTPError) as exc:
        logging.error("Failed to download Common Crawl record: %.200s", exc)
    return None


def lookup_redirected_warc(url, crawl_id="2025-13"):
    try:
        if not _is_http_url(url):
            raise RecordRejected("Invalid redirected index URL")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        }
        with _CrawlSession() as session:
            with _request(
                session,
                f"https://index.commoncrawl.org/CC-MAIN-{crawl_id}-index",
                headers,
                10,
                params={"url": url, "output": "json", "limit": 1},
                index_lookup=True,
            ) as response:
                _check_response(response, 200, MAX_DOWNLOAD_BYTES)
                line = bytearray()
                for chunk in _bounded_chunks(
                    lambda size: response.raw.read(size, decode_content=False),
                    MAX_DOWNLOAD_BYTES,
                ):
                    start = 0
                    while True:
                        end = chunk.find(b"\n", start)
                        if end < 0:
                            line.extend(chunk[start:])
                            break
                        line.extend(chunk[start:end])
                        if line.strip():
                            return _parse_index_record(line)
                        line.clear()
                        start = end + 1
                if line.strip():
                    return _parse_index_record(line)
                raise RecordRejected("No redirected index record")
    except RecordRejected as exc:
        logging.warning("Rejected Common Crawl index response: %.200s", exc)
    except (requests.exceptions.RequestException, Urllib3HTTPError) as exc:
        logging.error("Failed to look up redirected archive: %.200s", exc)
    return None


def _parse_index_record(line):
    try:
        record = json.loads(line)
    except (ValueError, RecursionError) as exc:
        raise RecordRejected("Malformed redirected index JSON") from exc
    _validate_warc_record(record)
    if not _is_http_url(record.get("url")):
        raise RecordRejected("Invalid redirected index record URL")
    return record


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

    host = urlparse(url).hostname
    if restaurant_data and host.endswith(".opentable.com"):
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
        if not isinstance(record, dict) or not _is_http_url(record.get("url")):
            logging.warning("Skipping record with an invalid or missing URL")
            continue
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
