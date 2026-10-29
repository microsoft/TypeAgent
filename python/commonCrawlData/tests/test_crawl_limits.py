# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import unittest

from crawl_limits import (
    DEFAULT_BATCH_SIZE,
    DEFAULT_CRAWL_ID,
    DEFAULT_LIMIT,
    MAX_BATCH_SIZE,
    MAX_URLS,
    CrawlValidationError,
    bounded_positive_integer,
    validate_crawl_params,
    validate_search_params,
)


class CrawlLimitsTests(unittest.TestCase):
    def test_positive_integer_boundaries(self):
        for name, maximum in (("limit", MAX_URLS), ("batch_size", MAX_BATCH_SIZE)):
            for value in (1, maximum, "1", str(maximum)):
                with self.subTest(name=name, value=value):
                    self.assertEqual(
                        bounded_positive_integer(value, name, maximum), int(value)
                    )
            for value in (
                0, -1, maximum + 1, "0", "-1", str(maximum + 1),
                None, True, False, 1.0, 1.5, [], {},
                "", " ", "oops", "1.0", "1e1", "1_0", "\u0661", "+", "--1",
            ):
                with self.subTest(name=name, value=value):
                    with self.assertRaisesRegex(
                        CrawlValidationError, f"{name}.*1 and {maximum}"
                    ):
                        bounded_positive_integer(value, name, maximum)

    def test_decimal_whitespace_sign_and_leading_zeros(self):
        for value in (" +00012 ", "\t12\n", "00012"):
            self.assertEqual(bounded_positive_integer(value, "limit", MAX_URLS), 12)

    def test_long_decimal_is_checked_before_integer_conversion(self):
        with self.assertRaises(CrawlValidationError) as caught:
            bounded_positive_integer("9" * 10000, "limit", MAX_URLS)
        self.assertLess(len(str(caught.exception)), 100)
        self.assertEqual(
            bounded_positive_integer("0" * 10000 + "1", "limit", MAX_URLS), 1
        )

    def test_defaults_and_search_patterns_are_preserved(self):
        for prefix in ("example.com", "*.example.com/path", "example.com/?a=1&b=2"):
            self.assertEqual(
                validate_crawl_params({"url_prefix": prefix}),
                {
                    "url_prefix": prefix,
                    "limit": DEFAULT_LIMIT,
                    "batch_size": DEFAULT_BATCH_SIZE,
                    "crawl_id": DEFAULT_CRAWL_ID,
                },
            )
        self.assertEqual(
            validate_search_params({"url_prefix": "example.com"}, default_limit=100)["limit"],
            100,
        )

    def test_direct_input_does_not_default_explicit_invalid_values(self):
        for field in ("limit", "batch_size", "crawl_id", "url_prefix"):
            for value in (None, "", False, 1.5, [], {}):
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(CrawlValidationError, field):
                        validate_crawl_params({"url_prefix": "example.com", field: value})

    def test_input_shape_and_blank_prefix(self):
        for params in (None, [], "{}", True, 42, {}, {"url_prefix": " \t"}):
            with self.subTest(params=params):
                with self.assertRaises(CrawlValidationError):
                    validate_crawl_params(params)

    def test_crawl_id_cannot_change_index_url_structure(self):
        for value in (" ", "2025 13", "2025/13", "x\\y", "x?limit=2", "x#y",
                      "x&limit=2", "x%2fy", "x\n", "x\x00", "x\x7f"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(CrawlValidationError, "crawl_id"):
                    validate_search_params({"url_prefix": "example.com", "crawl_id": value})
        self.assertEqual(
            validate_search_params({"url_prefix": "example.com", "crawl_id": "custom-collection"})["crawl_id"],
            "custom-collection",
        )
