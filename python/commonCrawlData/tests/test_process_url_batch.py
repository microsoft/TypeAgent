# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import gzip
import io
import json
import re
import subprocess
import sys
import textwrap
import unittest
import zlib
from unittest import mock
from urllib.parse import parse_qs, urlparse

import requests
from requests.adapters import BaseAdapter
from warcio.statusandheaders import StatusAndHeaders
from warcio.warcwriter import WARCWriter
from urllib3.exceptions import HTTPError as Urllib3HTTPError
from urllib3.response import HTTPResponse

import process_url_batch as crawl


TARGET = "https://example.test/restaurant"
HTML = (
    b'<html><script type="application/ld+json">'
    b'{"@context":"https://schema.org","@type":"Restaurant","name":"Fixture Bistro"}'
    b"</script></html>"
)


def make_warc(
    payload=HTML, headers=(), status="200 OK", compressed=True, rec_type="response"
):
    output = io.BytesIO()
    writer = WARCWriter(output, gzip=compressed)
    http_headers = None
    if rec_type == "response":
        http_headers = StatusAndHeaders(
            status,
            [("Content-Type", "text/html"), ("Content-Length", str(len(payload)))]
            + list(headers),
            protocol="HTTP/1.1",
        )
    record = writer.create_warc_record(
        TARGET, rec_type, payload=io.BytesIO(payload), http_headers=http_headers
    )
    try:
        writer.write_record(record)
        return output.getvalue()
    finally:
        record.raw_stream.close()
        output.close()


def index_record(length, **updates):
    record = {
        "url": TARGET,
        "filename": "crawl-data/test/warc/fixture.warc.gz",
        "offset": "0",
        "length": str(length),
    }
    record.update(updates)
    return record


class CountingRaw(io.BytesIO):
    def __init__(self, body):
        super().__init__(body)
        self.consumed = 0
        self.reads = []

    def read(self, size=-1, decode_content=None):
        if size <= 0:
            raise AssertionError("HTTP reads must have a positive finite size")
        if decode_content is not False:
            raise AssertionError("HTTP reads must not decode content")
        self.reads.append(size)
        result = super().read(size)
        self.consumed += len(result)
        return result


class StreamResponse(requests.Response):
    def __init__(self, body, status=206, headers=None):
        super().__init__()
        self.status_code = status
        self.raw = CountingRaw(body)
        self.headers.update(headers or {})

    @property
    def content(self):
        raise AssertionError("Do not access response.content")

    @property
    def text(self):
        raise AssertionError("Do not access response.text")


class SequenceAdapter(BaseAdapter):
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.closed = False

    def send(self, request, **kwargs):
        self.requests.append((request, kwargs))
        if not self.responses:
            raise AssertionError("Unexpected additional HTTP request")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        response.url = request.url
        response.request = request
        return response

    def close(self):
        self.closed = True


def session_for(*responses):
    session = crawl._CrawlSession()
    adapter = SequenceAdapter(responses)
    session.mount("https://", adapter)
    return session, adapter


class CrawlTestCase(unittest.TestCase):
    def setUp(self):
        self.sleep = self.enterContext(mock.patch.object(crawl.time, "sleep"))
        self.enterContext(
            mock.patch.object(crawl.random, "uniform", return_value=0.25)
        )
        self.warning = self.enterContext(mock.patch.object(crawl.logging, "warning"))
        self.error = self.enterContext(mock.patch.object(crawl.logging, "error"))


class ExtractionTests(CrawlTestCase):
    def download(self, body, *, record=None, response=None, preceding=()):
        response = response if response is not None else StreamResponse(body)
        session, adapter = session_for(*preceding, response)
        with mock.patch.object(crawl, "_CrawlSession", return_value=session):
            result = crawl.download_and_extract_warc(
                record if record is not None else index_record(len(body))
            )
        self.assertTrue(response.raw.closed)
        self.assertTrue(adapter.closed)
        return result, response, adapter

    def test_normal_html_and_transport_options(self):
        body = make_warc()
        result, response, adapter = self.download(body)
        self.assertEqual(result, HTML.decode())
        request, options = adapter.requests[0]
        self.assertEqual(request.headers["Range"], f"bytes=0-{len(body) - 1}")
        self.assertEqual(request.headers["Accept-Encoding"], "identity")
        self.assertTrue(options["stream"])
        self.assertEqual(options["timeout"], 30)
        self.assertEqual(response.raw.consumed, len(body))
        self.assertTrue(
            all(0 < size <= crawl.READ_CHUNK_BYTES for size in response.raw.reads)
        )

    def test_real_urllib3_body_is_streamed_without_content_decoding(self):
        body = make_warc()
        source = io.BytesIO(body)
        response = StreamResponse(b"")
        response.raw.close()
        response.raw = HTTPResponse(
            source, preload_content=False, decode_content=True,
            headers={"Content-Length": str(len(body))},
        )
        with mock.patch.object(response.raw, "read", wraps=response.raw.read) as reads:
            result, _, _ = self.download(body, response=response)
        self.assertEqual(result, HTML.decode())
        self.assertTrue(source.closed)
        self.assertTrue(all(
            call.kwargs["decode_content"] is False for call in reads.call_args_list
        ))

    def test_stream_read_failure_closes_response_and_session(self):
        body = make_warc()
        response = StreamResponse(body)
        with mock.patch.object(
            response.raw, "read", side_effect=Urllib3HTTPError("read failed")
        ):
            result, _, adapter = self.download(body, response=response)
        self.assertIsNone(result)
        self.assertEqual(len(adapter.requests), 1)
        self.error.assert_called()

    def test_invalid_metadata_makes_no_requests(self):
        valid = index_record(10)
        records = [None, [], "record", {}]
        for field in ("offset", "length", "filename"):
            record = valid.copy()
            del record[field]
            records.append(record)
        for offset in (-1, "-1", True, 1.0, "1.0", "", "oops"):
            records.append(dict(valid, offset=offset))
        for length in (0, -1, "-1", True, 1.0, "oops", crawl.MAX_DOWNLOAD_BYTES + 1):
            records.append(dict(valid, length=length))
        for filename in ("", "/absolute", "../file", "a/../b", "a\\b", "a?x=1",
                         "https://other.test/file", "a\r\nb", "//other.test/file"):
            records.append(dict(valid, filename=filename))
        with mock.patch.object(crawl, "_CrawlSession") as factory:
            for record in records:
                with self.subTest(record=record):
                    self.assertIsNone(crawl.download_and_extract_warc(record))
            factory.assert_not_called()
        self.warning.assert_called()

    def test_download_exact_limit_and_one_byte_over(self):
        body = make_warc()
        with mock.patch.object(crawl, "MAX_DOWNLOAD_BYTES", len(body)):
            result, _, _ = self.download(body)
            self.assertEqual(result, HTML.decode())
            result, response, adapter = self.download(
                body + b"x" * 10000, record=index_record(len(body))
            )
            self.assertIsNone(result)
            self.assertEqual(response.raw.consumed, len(body) + 1)
            self.assertEqual(len(adapter.requests), 1)

    def test_response_headers_are_checked_without_reading_body(self):
        body = make_warc()
        cases = [
            (200, {}),
            (404, {}),
            (206, {"Content-Encoding": "gzip"}),
            (206, {"Content-Length": str(len(body) + 1)}),
            (206, {"Content-Length": str(len(body) - 1)}),
            (206, {"Content-Length": "-1"}),
            (206, {"Content-Length": "not a number"}),
            (206, {"Content-Range": "invalid"}),
            (206, {"Content-Range": f"bytes 1-{len(body)}/{len(body) + 1}"}),
            (206, {"Content-Range": f"bytes 0-{len(body) - 1}/{len(body) - 1}"}),
        ]
        for status, headers in cases:
            with self.subTest(status=status, headers=headers):
                response = StreamResponse(body, status, headers)
                result, _, _ = self.download(body, response=response)
                self.assertIsNone(result)
                self.assertEqual(response.raw.consumed, 0)

    def test_matching_headers_and_nonzero_offset(self):
        body = make_warc()
        response = StreamResponse(body, headers={
            "Content-Length": str(len(body)),
            "Content-Range": f"bytes 100-{99 + len(body)}/*",
        })
        result, _, adapter = self.download(
            body, record=index_record(len(body), offset="100"), response=response
        )
        self.assertEqual(result, HTML.decode())
        self.assertEqual(
            adapter.requests[0][0].headers["Range"], f"bytes=100-{99 + len(body)}"
        )

    def test_short_response_is_rejected(self):
        body = make_warc()
        result, response, _ = self.download(body[:-1], record=index_record(len(body)))
        self.assertIsNone(result)
        self.assertEqual(response.raw.consumed, len(body) - 1)

    def test_live_redirect_is_closed_without_hidden_body_reads(self):
        body = make_warc()
        response = StreamResponse(
            b"must not be read", 302, {"Location": "https://other.test"}
        )
        result, _, adapter = self.download(body, response=response)
        self.assertIsNone(result)
        self.assertEqual(response.raw.consumed, 0)
        self.assertEqual(len(adapter.requests), 1)

    def test_status_retries_close_bodies_without_draining(self):
        body = make_warc()
        preceding = [StreamResponse(b"unread", 500), StreamResponse(b"unread", 502)]
        result, _, adapter = self.download(body, preceding=preceding)
        self.assertEqual(result, HTML.decode())
        self.assertEqual(len(adapter.requests), 3)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2)])
        for response in preceding:
            self.assertTrue(response.raw.closed)
            self.assertEqual(response.raw.consumed, 0)

    def test_status_retries_are_finite(self):
        body = make_warc()
        responses = [StreamResponse(b"unread", 503) for _ in range(6)]
        result, _, adapter = self.download(
            body, response=responses[-1], preceding=responses[:-1]
        )
        self.assertIsNone(result)
        self.assertEqual(len(adapter.requests), 6)
        self.assertEqual(
            [call.args[0] for call in self.sleep.call_args_list], [2, 4, 8, 16]
        )
        self.assertTrue(all(response.raw.closed for response in responses))
        self.assertTrue(all(response.raw.consumed == 0 for response in responses))

    def test_dns_and_connection_retries_are_bounded(self):
        for message, count, delays in [
            ("NameResolutionError", 3, [2, 4]),
            ("connection refused", 6, [2, 4, 8, 16]),
        ]:
            with self.subTest(message=message):
                session, adapter = session_for(*[
                    requests.exceptions.ConnectionError(message) for _ in range(count)
                ])
                self.sleep.reset_mock()
                with mock.patch.object(crawl, "_CrawlSession", return_value=session):
                    self.assertIsNone(
                        crawl.download_and_extract_warc(index_record(10))
                    )
                self.assertEqual(len(adapter.requests), count)
                self.assertTrue(adapter.closed)
                self.assertEqual(
                    [call.args[0] for call in self.sleep.call_args_list], delays
                )

    def test_archive_timeout_is_not_retried(self):
        session, adapter = session_for(requests.exceptions.Timeout("timeout"))
        with mock.patch.object(crawl, "_CrawlSession", return_value=session):
            self.assertIsNone(crawl.download_and_extract_warc(index_record(10)))
        self.assertEqual(len(adapter.requests), 1)
        self.assertTrue(adapter.closed)

    def test_outer_warc_exact_limit_and_one_byte_over(self):
        plain = make_warc(compressed=False)
        for body in (plain, gzip.compress(plain)):
            for limit, expected in [
                (len(plain), HTML.decode()), (len(plain) - 1, None)
            ]:
                with self.subTest(compressed=body != plain, limit=limit):
                    with mock.patch.object(crawl, "MAX_WARC_BYTES", limit):
                        result, _, _ = self.download(body)
                    self.assertEqual(result, expected)

    def test_outer_gzip_concatenated_members_share_budget(self):
        plain = make_warc(compressed=False)
        body = gzip.compress(plain[:100]) + gzip.compress(plain[100:])
        with mock.patch.object(crawl, "MAX_WARC_BYTES", len(plain)):
            self.assertEqual(self.download(body)[0], HTML.decode())
        with mock.patch.object(crawl, "MAX_WARC_BYTES", len(plain) - 1):
            self.assertIsNone(self.download(body)[0])

    def test_trailing_warc_garbage_is_not_accepted_after_valid_html(self):
        plain = make_warc(compressed=False)
        for body in (plain + b"garbage", gzip.compress(plain + b"garbage")):
            with self.subTest(compressed=body.startswith(b"\x1f\x8b")):
                self.assertIsNone(self.download(body)[0])

    def test_non_response_before_html_preserves_extraction(self):
        body = make_warc(b"metadata", compressed=False, rec_type="resource")
        body += make_warc(compressed=False)
        self.assertEqual(self.download(body)[0], HTML.decode())

    def test_outer_gzip_malformed_truncated_trailing_and_nested(self):
        body = make_warc()
        corrupt = bytearray(body)
        corrupt[-8] ^= 1
        for malformed in (
            bytes(corrupt), body[:-1], body + b"garbage", gzip.compress(body)
        ):
            with self.subTest(prefix=malformed[:8]):
                self.assertIsNone(self.download(malformed)[0])

    def test_http_content_formats_and_exact_decoded_limits(self):
        formats = [
            ((), HTML),
            ((("Content-Encoding", "identity"),), HTML),
            ((("Content-Encoding", " GZip "),), gzip.compress(HTML)),
            ((("Content-Encoding", "x-gzip"),), gzip.compress(HTML)),
            ((("Content-Encoding", "deflate"),), zlib.compress(HTML)),
            ((("Content-Encoding", "deflate"),), zlib.compress(HTML, wbits=-15)),
        ]
        for headers, payload in formats:
            body = make_warc(payload, headers)
            for limit, expected in [(len(HTML), HTML.decode()), (len(HTML) - 1, None)]:
                with self.subTest(headers=headers, limit=limit):
                    with mock.patch.object(crawl, "MAX_HTML_BYTES", limit):
                        self.assertEqual(self.download(body)[0], expected)

    def test_inner_gzip_concatenated_members_share_budget(self):
        payload = gzip.compress(HTML[:20]) + gzip.compress(HTML[20:])
        body = make_warc(payload, [("Content-Encoding", "gzip")])
        with mock.patch.object(crawl, "MAX_HTML_BYTES", len(HTML)):
            self.assertEqual(self.download(body)[0], HTML.decode())
        with mock.patch.object(crawl, "MAX_HTML_BYTES", len(HTML) - 1):
            self.assertIsNone(self.download(body)[0])

    def test_oversized_identity_html_is_rejected_before_copying_payload(self):
        body = make_warc(b"x" * 10000)
        with mock.patch.object(crawl, "MAX_HTML_BYTES", 1024):
            with mock.patch.object(
                crawl, "_bounded_chunks", wraps=crawl._bounded_chunks
            ) as reads:
                self.assertIsNone(self.download(body)[0])
        self.assertEqual(
            reads.call_count, 1, "Only the archive download should have been read"
        )

    def test_invalid_content_encodings_are_not_returned_as_html(self):
        cases = [
            [("Content-Encoding", "gzip"), ("content-encoding", "identity")],
            [("Content-Encoding", "gzip, identity")],
            [("Content-Encoding", "gzip,")],
            [("Content-Encoding", "identity, identity")],
            [("Content-Encoding", "br")],
            [("Content-Encoding", "")],
            [("Transfer-Encoding", "chunked, chunked")],
            [("Transfer-Encoding", "gzip")],
        ]
        for headers in cases:
            with self.subTest(headers=headers):
                self.assertIsNone(self.download(make_warc(HTML, headers))[0])

    def test_corrupt_inner_compression_is_not_retried_as_raw(self):
        for coding, payload in [
            ("gzip", gzip.compress(HTML)), ("deflate", zlib.compress(HTML))
        ]:
            corrupt = bytearray(payload)
            corrupt[-1] ^= 1
            for malformed in (bytes(corrupt), payload[:-1], payload + b"garbage"):
                with self.subTest(coding=coding, malformed=malformed[-8:]):
                    body = make_warc(malformed, [("Content-Encoding", coding)])
                    result, _, adapter = self.download(body)
                    self.assertIsNone(result)
                    self.assertEqual(len(adapter.requests), 1)

    def test_chunked_identity_and_gzip_with_extensions_and_trailers(self):
        for compressed in (False, True):
            payload = gzip.compress(HTML) if compressed else HTML
            chunks = (
                f"{len(payload):X};fixture=yes\r\n".encode()
                + payload + b"\r\n0\r\nX-Fixture: complete\r\n\r\n"
            )
            headers = [("Transfer-Encoding", "Chunked")]
            if compressed:
                headers.append(("Content-Encoding", "gzip"))
            body = make_warc(chunks, headers)
            self.assertEqual(self.download(body)[0], HTML.decode())
            with mock.patch.object(crawl, "MAX_HTML_BYTES", len(HTML) - 1):
                self.assertIsNone(self.download(body)[0])

    def test_invalid_chunk_framing_is_rejected(self):
        cases = [
            b"-1\r\nhello\r\n0\r\n\r\n",
            b"+5\r\nhello\r\n0\r\n\r\n",
            b"0x5\r\nhello\r\n0\r\n\r\n",
            b"0_5\r\nhello\r\n0\r\n\r\n",
            b"\r\nhello\r\n0\r\n\r\n",
            b"5\nhello\r\n0\r\n\r\n",
            b"5\r\nhell",
            b"5\r\nhelloXX0\r\n\r\n",
            b"5\r\nhello\r\n0\r\n\r\nextra",
            b"5\r\nhello\r\n0\r\nBad trailer\r\n\r\n",
            b"5\r\nhello\r\n0\r\n",
            b"F" * 100 + b"\r\n",
            b"5;extension=bad\rvalue\r\nhello\r\n0\r\n\r\n",
            b"5\r\nhello\r\n0\r\nX-Fixture: bad\rvalue\r\n\r\n",
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                body = make_warc(payload, [("Transfer-Encoding", "chunked")])
                self.assertIsNone(self.download(body)[0])

    def test_chunked_identity_stops_before_copying_oversized_chunk(self):
        payload = b"1000\r\n" + b"x" * 4096 + b"\r\n0\r\n\r\n"
        read_sizes = []
        real_stream = io.BytesIO

        class ObservedStream(real_stream):
            def read(self, size=-1):
                read_sizes.append(size)
                return super().read(size)

        headers = StatusAndHeaders("200 OK", [("Transfer-Encoding", "chunked")])
        with mock.patch.object(crawl, "MAX_HTML_BYTES", 1024):
            with mock.patch.object(crawl.io, "BytesIO", ObservedStream):
                with self.assertRaises(crawl.RecordRejected):
                    crawl._decode_html(payload, headers)
        self.assertEqual(read_sizes, [])

    def test_invalid_warc_metadata_and_truncation(self):
        plain = make_warc(compressed=False)
        match = re.search(rb"Content-Length: ([0-9]+)", plain)
        length = int(match.group(1))
        cases = [
            b"",
            b"WARC/1.0\r\n",
            plain[:-8],
            plain.replace(b"WARC-Target-URI:", b"Missing-Target:"),
            plain.replace(TARGET.encode(), b"file:///not-http"),
            plain.replace(b"HTTP/1.1 200 OK", b"INVALID 200 OK"),
        ]
        for value in (
            b"-1", b"oops", str(length - 1).encode(), str(length + 10).encode()
        ):
            cases.append(plain[:match.start(1)] + value + plain[match.end(1):])
        cases.append(
            plain[:match.start()] + plain[plain.find(b"\r\n", match.start()) + 2:]
        )
        for body in cases:
            with self.subTest(prefix=body[:32]):
                self.assertIsNone(
                    self.download(body, record=index_record(max(1, len(body))))[0]
                )

    def test_non_response_and_non_html_records_are_skipped(self):
        for body in (
            make_warc(b"resource", rec_type="resource"),
            make_warc(b"image", compressed=False).replace(b"text/html", b"image/png"),
        ):
            with self.subTest(body=body[:8]):
                self.assertIsNone(self.download(body)[0])

    def test_utf8_replacement_is_preserved(self):
        payload = b"<html>\xff</html>"
        self.assertEqual(
            self.download(make_warc(payload))[0],
            payload.decode("utf-8", errors="replace"),
        )

    def test_missing_http_header_terminator_is_rejected_before_redirect_lookup(self):
        plain = make_warc(b"", [("Location", "/moved")], "302 Found", compressed=False)
        length_match = re.search(rb"Content-Length: ([0-9]+)", plain)
        new_length = str(int(length_match.group(1)) - 2).encode()
        malformed = plain[:-6] + plain[-4:]
        malformed = (
            malformed[:length_match.start(1)] + new_length
            + malformed[length_match.end(1):]
        )
        with mock.patch.object(
            crawl, "lookup_redirected_warc", return_value=None
        ) as lookup:
            self.assertIsNone(self.download(malformed)[0])
            lookup.assert_not_called()

    def test_malformed_archived_redirect_url_is_a_record_rejection(self):
        body = make_warc(b"", [("Location", "https://[invalid")], "302 Found")
        self.assertIsNone(self.download(body)[0])

    def test_archived_redirect_closes_download_before_lookup(self):
        first = StreamResponse(
            make_warc(b"", [("Location", "/moved?x=1&y=2")], "302 Found")
        )
        second_body = make_warc()
        second = StreamResponse(second_body)
        first_session, first_adapter = session_for(first)
        second_session, _ = session_for(second)

        def lookup(location):
            self.assertTrue(first.raw.closed)
            self.assertTrue(first_adapter.closed)
            self.assertEqual(location, "https://example.test/moved?x=1&y=2")
            return index_record(len(second_body))

        with mock.patch.object(
            crawl, "_CrawlSession", side_effect=[first_session, second_session]
        ):
            with mock.patch.object(
                crawl, "lookup_redirected_warc", side_effect=lookup
            ) as redirect:
                result = crawl.download_and_extract_warc(
                    index_record(len(first.raw.getvalue()))
                )
        self.assertEqual(result, HTML.decode())
        self.assertEqual(redirect.call_count, 1)
        self.assertTrue(second.raw.closed)

    def test_redirected_metadata_is_validated_before_second_download(self):
        body = make_warc(
            b"", [("Location", "https://example.test/moved")], "301 Moved"
        )
        with mock.patch.object(
            crawl, "lookup_redirected_warc",
            return_value=index_record(crawl.MAX_DOWNLOAD_BYTES + 1),
        ):
            result, _, adapter = self.download(body)
        self.assertIsNone(result)
        self.assertEqual(len(adapter.requests), 1)

    def test_second_archived_redirect_is_not_followed(self):
        body = make_warc(b"", [("Location", "/again")], "302 Found")
        session, _ = session_for(StreamResponse(body))
        with mock.patch.object(crawl, "_CrawlSession", return_value=session):
            with mock.patch.object(crawl, "lookup_redirected_warc") as lookup:
                self.assertIsNone(crawl.download_and_extract_warc(
                    index_record(len(body)), redirect_handled=True
                ))
                lookup.assert_not_called()

    def test_rejected_records_do_not_interrupt_real_batch_extraction(self):
        bad_body = make_warc(
            gzip.compress(b"x" * 10000), [("Content-Encoding", "gzip")]
        )
        good_body = make_warc()
        sessions = [
            session_for(StreamResponse(body))[0] for body in (bad_body, good_body)
        ]
        records = [
            None, {}, {"url": None}, {"url": TARGET, "length": "bad"},
            index_record(len(bad_body)), index_record(len(good_body)),
        ]
        with mock.patch.object(crawl, "MAX_HTML_BYTES", len(HTML)):
            with mock.patch.object(crawl, "_CrawlSession", side_effect=sessions):
                result = crawl.main({
                    "batch": records, "batch_number": 1, "total_batches": 1
                })
        self.assertEqual(result["batch_number"], 1)
        self.assertEqual(result["total_urls"], len(records))
        self.assertEqual(result["extracted_count"], 1)
        self.assertEqual(result["results"][0]["name"], "Fixture Bistro")
        self.assertEqual(result["results"][0]["_source_url"], TARGET)


class IndexLookupTests(CrawlTestCase):
    def lookup(self, body, *, response=None, preceding=()):
        response = response if response is not None else StreamResponse(body, 200)
        session, adapter = session_for(*preceding, response)
        with mock.patch.object(crawl, "_CrawlSession", return_value=session):
            result = crawl.lookup_redirected_warc(TARGET + "?a=1&output=bad")
        self.assertTrue(response.raw.closed)
        self.assertTrue(adapter.closed)
        return result, response, adapter

    def test_index_parameters_and_first_record_only(self):
        record = index_record(10)
        first = json.dumps(record).encode() + b"\n"
        body = b"\n \r\n" + first + b"x" * 100000
        with mock.patch.object(crawl, "READ_CHUNK_BYTES", 32):
            result, response, adapter = self.lookup(body)
        self.assertEqual(result, record)
        self.assertLess(response.raw.consumed, len(first) + 4 + 32)
        query = parse_qs(urlparse(adapter.requests[0][0].url).query)
        self.assertEqual(query["url"], [TARGET + "?a=1&output=bad"])
        self.assertEqual(query["output"], ["json"])
        self.assertEqual(query["limit"], ["1"])

    def test_index_exact_limit_without_final_newline(self):
        record = index_record(10)
        body = json.dumps(record).encode()
        with mock.patch.object(crawl, "MAX_DOWNLOAD_BYTES", len(body)):
            self.assertEqual(self.lookup(body)[0], record)

    def test_index_long_line_and_blank_prefix_are_bounded(self):
        for body in (b"x" * 10000, b"\n" * 10000):
            with self.subTest(prefix=body[:4]):
                with mock.patch.object(crawl, "MAX_DOWNLOAD_BYTES", 256):
                    result, response, adapter = self.lookup(body)
                self.assertIsNone(result)
                self.assertEqual(response.raw.consumed, 257)
                self.assertEqual(len(adapter.requests), 1)

    def test_invalid_first_index_record_is_not_skipped_or_retried(self):
        valid = json.dumps(index_record(10)).encode()
        for first in (b"invalid", b"[]", b"null", b"{}", b"\xff"):
            with self.subTest(first=first):
                result, _, adapter = self.lookup(first + b"\n" + valid + b"\n")
                self.assertIsNone(result)
                self.assertEqual(len(adapter.requests), 1)

    def test_deeply_nested_index_json_is_a_record_rejection(self):
        body = b"[" * 2000 + b"0" + b"]" * 2000 + b"\n"
        result, _, adapter = self.lookup(body)
        self.assertIsNone(result)
        self.assertEqual(len(adapter.requests), 1)

    def test_index_redirect_and_oversized_header_are_closed_unread(self):
        for response in (
            StreamResponse(b"unread", 302, {"Location": "https://other.test"}),
            StreamResponse(
                b"unread", 200,
                {"Content-Length": str(crawl.MAX_DOWNLOAD_BYTES + 1)},
            ),
        ):
            result, _, adapter = self.lookup(b"", response=response)
            self.assertIsNone(result)
            self.assertEqual(response.raw.consumed, 0)
            self.assertEqual(len(adapter.requests), 1)

    def test_index_status_retry_and_transport_retry(self):
        body = json.dumps(index_record(10)).encode()
        rejected = StreamResponse(b"unread", 503)
        result, _, adapter = self.lookup(body, preceding=[
            rejected, requests.exceptions.Timeout("timeout")
        ])
        self.assertEqual(result, index_record(10))
        self.assertEqual(len(adapter.requests), 3)
        self.assertTrue(rejected.raw.closed)
        self.assertEqual(rejected.raw.consumed, 0)
        self.assertEqual(self.sleep.call_args_list, [mock.call(1.25), mock.call(2)])

    def test_index_retry_exhaustion(self):
        responses = [StreamResponse(b"unread", 503) for _ in range(5)]
        result, _, adapter = self.lookup(
            b"", response=responses[-1], preceding=responses[:-1]
        )
        self.assertIsNone(result)
        self.assertEqual(len(adapter.requests), 5)
        self.assertTrue(all(response.raw.closed for response in responses))
        self.assertTrue(all(response.raw.consumed == 0 for response in responses))


class DecoderMemoryTests(unittest.TestCase):
    def test_exact_output_limit_across_small_reads_and_gzip_members(self):
        payload = gzip.compress(HTML[:20]) + gzip.compress(HTML[20:])
        for chunk_size in (1, 7, 31):
            with self.subTest(chunk_size=chunk_size):
                with mock.patch.object(crawl, "READ_CHUNK_BYTES", chunk_size):
                    self.assertEqual(
                        crawl._decompress(payload, len(HTML), 31, True), HTML
                    )
                    with self.assertRaises(crawl.RecordRejected):
                        crawl._decompress(payload, len(HTML) - 1, 31, True)

    def test_decoder_stops_before_materializing_oversized_output(self):
        real_factory = zlib.decompressobj
        requests_seen = []
        output_sizes = []

        class ObservedDecoder:
            def __init__(self, wbits):
                self.decoder = real_factory(wbits)

            def decompress(self, data, max_length):
                requests_seen.append(max_length)
                result = self.decoder.decompress(data, max_length)
                output_sizes.append(len(result))
                return result

            def __getattr__(self, name):
                return getattr(self.decoder, name)

        payload = gzip.compress(b"x" * 100000)
        with mock.patch.object(
            crawl.zlib, "decompressobj", side_effect=ObservedDecoder
        ):
            with self.assertRaisesRegex(crawl.RecordRejected, "byte budget"):
                crawl._decompress(payload, 1024, 31, True)
        self.assertTrue(all(0 < size <= 1025 for size in requests_seen))
        self.assertEqual(sum(output_sizes), 1025)

    def test_isolated_decoder_allocation_stays_below_expanded_fixture(self):
        script = textwrap.dedent("""
            import gzip
            import json
            import tracemalloc
            import process_url_batch as crawl

            payload = gzip.compress(b"x" * (4 * 1024 * 1024))
            tracemalloc.start()
            try:
                crawl._decompress(payload, 1024, 31, True)
            except crawl.RecordRejected:
                rejected = True
            else:
                rejected = False
            peak = tracemalloc.get_traced_memory()[1]
            print(json.dumps({"rejected": rejected, "peak": peak}))
        """)
        result = subprocess.run(
            [sys.executable, "-c", script],
            check=True, capture_output=True, text=True, timeout=30,
        )
        measurements = json.loads(result.stdout)
        self.assertTrue(measurements["rejected"])
        # Leave ample allocator/platform tolerance, but not the 4 MiB expansion.
        self.assertLess(measurements["peak"], 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
