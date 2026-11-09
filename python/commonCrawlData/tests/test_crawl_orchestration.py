# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse

import azure.functions as func
from azure.durable_functions.models.history import HistoryEventType
import requests
import tldextract

from crawl_limits import (
    DEFAULT_CRAWL_ID,
    MAX_ACTIVITY_CALLS,
    MAX_BATCH_SIZE,
    MAX_IN_FLIGHT_ACTIVITIES,
    MAX_URLS,
    CrawlValidationError,
)
import get_urls as index
import http_start
import orchestrator
import process_url_batch as extraction
from test_process_url_batch import (
    StreamResponse,
    index_record,
    make_warc,
    session_for,
)


def url_records(count):
    return [{"url": f"https://example.com/{i}"} for i in range(count)]


class IndexResponse:
    def __init__(self, lines=(), status=200):
        self.lines = lines
        self.status_code = status
        self.closed = False
        self.consumed = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    @property
    def text(self):
        raise AssertionError("Index must not read the entire response")

    @property
    def content(self):
        raise AssertionError("Index must not read the entire response")

    def iter_lines(self):
        for line in self.lines:
            self.consumed += 1
            if isinstance(line, Exception):
                raise line
            yield line


class HttpStarterTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_and_empty_http_values_preserve_defaults_and_status_response(self):
        for method in ("GET", "POST"):
            for extra in ({}, {"limit": "", "batch_size": "", "crawl_id": ""}):
                with self.subTest(method=method, extra=extra):
                    req = func.HttpRequest(
                        method, "https://localhost/api/start", body=b"",
                        params={"url_prefix": "example.com", **extra},
                    )
                    with mock.patch.object(http_start.df, "DurableOrchestrationClient") as factory:
                        client = factory.return_value
                        client.start_new = mock.AsyncMock(return_value="fixture-id")
                        response = await http_start.main(req, "fixture-binding")
                        self.assertIs(response, client.create_check_status_response.return_value)
                        client.start_new.assert_awaited_once_with(
                            "orchestrator", None,
                            {"limit": 1000, "batch_size": 50,
                             "crawl_id": DEFAULT_CRAWL_ID, "url_prefix": "example.com"},
                        )
                        client.create_check_status_response.assert_called_once_with(req, "fixture-id")

    async def test_rejection_is_json_400_before_client_creation(self):
        cases = [
            {name: value}
            for name, maximum in (("limit", MAX_URLS), ("batch_size", MAX_BATCH_SIZE))
            for value in ("oops", " ", "0", "-1", "1.5", str(maximum + 1))
        ] + [{"url_prefix": ""}, {"url_prefix": " "}, {"crawl_id": "x?limit=99"}]
        for extra in cases:
            with self.subTest(extra=extra):
                req = func.HttpRequest(
                    "GET", "https://localhost/api/start", body=b"",
                    params={"url_prefix": "example.com", **extra},
                )
                with mock.patch.object(http_start.df, "DurableOrchestrationClient") as factory:
                    response = await http_start.main(req, "fixture-binding")
                    factory.assert_not_called()
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.mimetype, "application/json")
                error = json.loads(response.get_body())
                self.assertEqual(error["status"], "error")
                self.assertIn(next(iter(extra)), error["message"])

    async def test_valid_boundaries_and_numeric_normalization_start(self):
        for limit, batch_size in (("1", "1"), (str(MAX_URLS), str(MAX_BATCH_SIZE)), (" +0002 ", "01")):
            with self.subTest(limit=limit, batch_size=batch_size):
                req = func.HttpRequest(
                    "GET", "https://localhost/api/start", body=b"",
                    params={"url_prefix": "example.com", "limit": limit, "batch_size": batch_size},
                )
                with mock.patch.object(http_start.df, "DurableOrchestrationClient") as factory:
                    factory.return_value.start_new = mock.AsyncMock(return_value="fixture-id")
                    await http_start.main(req, "fixture-binding")
                    params = factory.return_value.start_new.await_args.args[2]
                self.assertEqual(params["limit"], int(limit))
                self.assertEqual(params["batch_size"], int(batch_size))


class IndexTests(unittest.TestCase):
    def fetch(self, response, limit=2, prefix="example.com"):
        with mock.patch.object(index.requests, "get", return_value=response) as get:
            result = index.get_urls(limit, DEFAULT_CRAWL_ID, prefix)
        self.assertTrue(response.closed)
        return result, get.call_args

    def test_empty_blank_and_exact_limit_responses(self):
        for lines, expected in (
            ([], []), ([b"", b" \t"], []),
            ([b"", b'{"url":"a"}', b'{"url":"b"}'], [{"url": "a"}, {"url": "b"}]),
        ):
            with self.subTest(lines=lines):
                result, call = self.fetch(IndexResponse(lines))
                self.assertEqual(result, expected)
                self.assertEqual(call.kwargs["params"]["limit"], 2)
                self.assertEqual(call.kwargs["timeout"], (5, 30))
                self.assertIs(call.kwargs["stream"], True)

    def test_prefix_is_one_encoded_query_parameter(self):
        prefix = "example.com/?a=1&limit=9999"
        _, call = self.fetch(IndexResponse([]), prefix=prefix)
        prepared = requests.Request("GET", call.args[0], params=call.kwargs["params"]).prepare()
        query = parse_qs(urlparse(prepared.url).query)
        self.assertEqual(query, {"url": [prefix + "*"], "output": ["json"], "limit": ["2"]})

    def test_overflow_stops_at_sentinel_and_closes_response(self):
        response = IndexResponse([b"{}"] * 10)
        with mock.patch.object(index.requests, "get", return_value=response) as get:
            with self.assertRaisesRegex(CrawlValidationError, "more records"):
                index.get_urls(2, DEFAULT_CRAWL_ID, "example.com")
        self.assertEqual(response.consumed, 3)
        self.assertTrue(response.closed)
        self.assertEqual(get.call_args.kwargs["params"]["limit"], 2)

    def test_requested_maximum_and_one_extra_record(self):
        result, _ = self.fetch(IndexResponse([b"{}"] * MAX_URLS), limit=MAX_URLS)
        self.assertEqual(len(result), MAX_URLS)
        response = IndexResponse([b"{}"] * (MAX_URLS + 1))
        with mock.patch.object(index.requests, "get", return_value=response):
            with self.assertRaisesRegex(CrawlValidationError, "more records"):
                index.get_urls(MAX_URLS, DEFAULT_CRAWL_ID, "example.com")
        self.assertTrue(response.closed)

    def test_parse_shape_and_iterator_errors_close_response(self):
        for bad in (b"invalid", b"[]", b"null", b"false", b"\xff",
                    b"[" * 2000, requests.exceptions.ConnectionError("read failed")):
            with self.subTest(bad=str(bad)[:40]):
                response = IndexResponse([bad])
                with mock.patch.object(index.requests, "get", return_value=response):
                    with self.assertLogs(level="ERROR"):
                        with self.assertRaises((CrawlValidationError, requests.exceptions.ConnectionError)):
                            index.get_urls(2, DEFAULT_CRAWL_ID, "example.com")
                self.assertTrue(response.closed)

    def test_non_200_retains_logged_empty_result_and_closes(self):
        response = IndexResponse([b"must not read"], status=503)
        with self.assertLogs(level="ERROR"):
            result, _ = self.fetch(response)
        self.assertEqual(result, [])
        self.assertEqual(response.consumed, 0)

    def test_timeout_propagates_instead_of_becoming_empty(self):
        with mock.patch.object(index.requests, "get", side_effect=requests.exceptions.Timeout):
            with self.assertLogs(level="ERROR"):
                with self.assertRaises(requests.exceptions.Timeout):
                    index.get_urls(2, DEFAULT_CRAWL_ID, "example.com")

    def test_wrapper_defaults_and_json_object_input(self):
        for params in ({"url_prefix": "example.com"}, '{"url_prefix":"example.com"}'):
            response = IndexResponse([b"{}"])
            with mock.patch.object(index.requests, "get", return_value=response) as get:
                self.assertEqual(index.main(params), [{}])
            self.assertEqual(get.call_args.kwargs["params"]["limit"], 100)
            self.assertTrue(response.closed)

    def test_wrapper_and_direct_helper_reject_invalid_inputs_without_http(self):
        for params in ("bad JSON", "[]", "null", [], None, True, 7):
            with self.subTest(params=params):
                with mock.patch.object(index.requests, "get") as get:
                    with self.assertLogs(level="ERROR"):
                        with self.assertRaises(CrawlValidationError):
                            index.main(params)
                    get.assert_not_called()
        for limit, crawl_id, prefix in (
            (0, DEFAULT_CRAWL_ID, "example.com"),
            (MAX_URLS + 1, DEFAULT_CRAWL_ID, "example.com"),
            (True, DEFAULT_CRAWL_ID, "example.com"),
            (2, "x?limit=999", "example.com"), (2, DEFAULT_CRAWL_ID, " "),
        ):
            with self.subTest(limit=limit, crawl_id=crawl_id, prefix=prefix):
                with mock.patch.object(index.requests, "get") as get:
                    with self.assertLogs(level="ERROR"):
                        with self.assertRaises(CrawlValidationError):
                            index.get_urls(limit, crawl_id, prefix)
                    get.assert_not_called()


class DurableDriver:
    """Resolve only yielded tasks, tracking scheduled but unfinished work."""

    def __init__(self, params, urls, process=None, save=None):
        self.params = params
        self.urls = urls
        self.process = process
        self.save = save
        self.calls = []
        self.outstanding = set()
        self.peak = 0
        self.groups = []
        self.current_utc_datetime = datetime(2026, 10, 22, tzinfo=timezone.utc)

    def get_input(self):
        return self.params

    def call_activity(self, name, payload):
        task = SimpleNamespace(id=len(self.calls), name=name, payload=payload)
        self.calls.append(task)
        self.outstanding.add(task.id)
        self.peak = max(self.peak, len(self.outstanding))
        return task

    def task_all(self, tasks):
        return tasks

    def result_for(self, task):
        if task.name == "get_urls":
            if isinstance(self.urls, Exception):
                raise self.urls
            return self.urls
        if task.name == "process_url_batch":
            if self.process is not None:
                return self.process(task.payload)
            return {"results": [{"name": item["url"]} for item in task.payload["batch"]]}
        if self.save is not None:
            return self.save(task.payload)
        return {
            "json_url": f"https://storage.test/{task.payload['json_name']}",
            "csv_url": f"https://storage.test/{task.payload['csv_name']}",
        }

    def resolve(self, pending):
        tasks = pending if isinstance(pending, list) else [pending]
        self.groups.append([task.name for task in tasks])
        results = []
        for task in tasks:
            try:
                results.append(self.result_for(task))
            finally:
                self.outstanding.remove(task.id)
        self.current_utc_datetime += timedelta(seconds=1)
        return results if isinstance(pending, list) else results[0]

    def run(self):
        generator = orchestrator.orchestrator_function(self)
        try:
            pending = next(generator)
            while True:
                try:
                    result = self.resolve(pending)
                except Exception as exc:
                    pending = generator.throw(exc)
                else:
                    pending = generator.send(result)
        except StopIteration as done:
            return done.value

    def named(self, name):
        return [task.payload for task in self.calls if task.name == name]


class OrchestrationTests(unittest.TestCase):
    def test_real_sdk_entry_point_replays_processing_and_save_windows(self):
        params = {"url_prefix": "example.com", "limit": 9, "batch_size": 2}
        clock = datetime(2026, 10, 22, tzinfo=timezone.utc)

        def event(kind, event_id, **extra):
            return {
                "EventType": kind.value, "EventId": event_id, "IsPlayed": True,
                "Timestamp": clock.isoformat(), **extra,
            }

        history = [
            event(HistoryEventType.ORCHESTRATOR_STARTED, -1),
            event(
                HistoryEventType.EXECUTION_STARTED, -1, Name="orchestrator",
                Input=json.dumps(params), Version=None,
            ),
        ]

        def replay():
            context = {
                "history": history, "instanceId": "fixture", "isReplaying": True,
                "parentInstanceId": None, "input": json.dumps(params),
            }
            return json.loads(orchestrator.main(
                SimpleNamespace(body=json.dumps(context))
            ))

        state = replay()
        groups = []
        saved_batches = []
        combined = None
        next_id = 0
        batch_count = (params["limit"] + params["batch_size"] - 1) // params["batch_size"]
        while not state["isDone"]:
            self.assertLess(next_id, 2 * batch_count + 2, "SDK replay stopped making progress")
            group = state["actions"][-1]
            groups.append([action["functionName"] for action in group])
            self.assertLessEqual(len(group), MAX_IN_FLIGHT_ACTIVITIES)
            clock += timedelta(seconds=1)
            history.append(event(HistoryEventType.ORCHESTRATOR_STARTED, -1))
            scheduled = list(enumerate(group, next_id))
            for task_id, action in scheduled:
                history.append(event(
                    HistoryEventType.TASK_SCHEDULED, task_id,
                    Name=action["functionName"], Input=action["input"],
                ))
                if action["functionName"] == "save_results":
                    payload = json.loads(action["input"])
                    if "results" in payload:
                        saved_batches.append(payload)
                    else:
                        combined = payload
            for task_id, action in reversed(scheduled):
                payload = json.loads(action["input"])
                if action["functionName"] == "get_urls":
                    result = url_records(params["limit"])
                elif action["functionName"] == "process_url_batch":
                    result = {"results": [{"name": row["url"]} for row in payload["batch"]]}
                else:
                    result = {
                        "json_url": f"https://storage.test/{payload['json_name']}",
                        "csv_url": f"https://storage.test/{payload['csv_name']}",
                    }
                history.append(event(
                    HistoryEventType.TASK_COMPLETED, task_id + 100,
                    TaskScheduledId=task_id, Result=json.dumps(result),
                ))
            next_id += len(group)
            state = replay()
        self.assertEqual(groups, [
            ["get_urls"], ["process_url_batch"] * 4, ["process_url_batch"],
            ["save_results"] * 4, ["save_results"], ["save_results"],
        ])
        self.assertEqual(state["output"]["total_urls_processed"], params["limit"])
        self.assertEqual(state["output"]["restaurants_extracted"], params["limit"])
        self.assertEqual(
            [row["name"] for batch in saved_batches for row in batch["results"]],
            [row["url"] for row in url_records(params["limit"])],
        )
        self.assertEqual(
            combined["json_files_urls"],
            [f"https://storage.test/{batch['json_name']}" for batch in saved_batches],
        )
        self.assertEqual(replay(), state)

    def test_invalid_direct_inputs_schedule_nothing(self):
        cases = [None, [], "{}", {}, {"url_prefix": " "}]
        cases += [
            {"url_prefix": "example.com", name: value}
            for name, maximum in (("limit", MAX_URLS), ("batch_size", MAX_BATCH_SIZE))
            for value in (0, -1, None, True, 1.5, "", "oops", maximum + 1)
        ]
        cases += [{"url_prefix": "example.com", "crawl_id": "x?limit=999"}]
        for params in cases:
            with self.subTest(params=params):
                driver = DurableDriver(params, [])
                self.assertEqual(driver.run()["status"], "error")
                self.assertEqual(driver.calls, [])

    def test_direct_defaults_reach_index_unchanged(self):
        driver = DurableDriver({"url_prefix": "example.com"}, [])
        self.assertEqual(driver.run()["status"], "error")
        self.assertEqual(driver.named("get_urls"), [
            {"limit": 1000, "crawl_id": DEFAULT_CRAWL_ID, "url_prefix": "example.com"}
        ])

    def test_bad_or_excess_index_results_schedule_no_processing(self):
        for urls in (None, False, "", {}, [None], url_records(3), url_records(MAX_URLS + 1)):
            with self.subTest(kind=type(urls).__name__):
                driver = DurableDriver({"url_prefix": "example.com", "limit": 2}, urls)
                self.assertEqual(driver.run()["status"], "error")
                self.assertEqual([task.name for task in driver.calls], ["get_urls"])

    def test_windows_total_budget_order_and_storage_contract(self):
        for count, batch_size in ((1, 50), (50, 50), (51, 50), (4, 1), (5, 1),
                                  (9, 2), (1000, 50), (1000, 1)):
            with self.subTest(count=count, batch_size=batch_size):
                urls = url_records(count)
                driver = DurableDriver(
                    {"url_prefix": "example.com", "limit": count, "batch_size": batch_size},
                    urls,
                )
                result = driver.run()
                batches = (count + batch_size - 1) // batch_size
                self.assertEqual(len(driver.calls), 2 * batches + 2)
                self.assertLessEqual(len(driver.calls), MAX_ACTIVITY_CALLS)
                self.assertLessEqual(driver.peak, MAX_IN_FLIGHT_ACTIVITIES)
                self.assertEqual(driver.outstanding, set())
                processed = driver.named("process_url_batch")
                self.assertEqual([item["batch_number"] for item in processed], list(range(1, batches + 1)))
                self.assertTrue(all(item["total_batches"] == batches for item in processed))
                self.assertEqual([row for item in processed for row in item["batch"]], urls)
                saves = driver.named("save_results")
                self.assertEqual([row["name"] for item in saves[:-1] for row in item["results"]],
                                 [row["url"] for row in urls])
                self.assertEqual(saves[-1]["json_files_urls"], [
                    f"https://storage.test/{item['json_name']}" for item in saves[:-1]
                ])
                self.assertEqual(result, {
                    "status": "success", "total_urls_processed": count,
                    "restaurants_extracted": count,
                    "combined_json_url": f"https://storage.test/{saves[-1]['json_name']}",
                    "combined_csv_url": f"https://storage.test/{saves[-1]['csv_name']}",
                })
                self.assertEqual(
                    [group[0] for group in driver.groups],
                    ["get_urls"] + ["process_url_batch"] * ((batches + 3) // 4)
                    + ["save_results"] * ((batches + 3) // 4) + ["save_results"],
                )

    def test_invalid_first_processing_window_stops_later_windows(self):
        for result in (None, {}, {"results": None}, {"results": [False]}, {"results": [{}, {}]}):
            with self.subTest(result=result):
                driver = DurableDriver(
                    {"url_prefix": "example.com", "batch_size": 1}, url_records(9),
                    process=lambda _: result,
                )
                self.assertEqual(driver.run()["status"], "error")
                self.assertEqual(len(driver.named("process_url_batch")), MAX_IN_FLIGHT_ACTIVITIES)
                self.assertEqual(driver.named("save_results"), [])

    def test_invalid_save_window_or_combined_result_cannot_report_success(self):
        for bad in (None, {}, {"json_url": "", "csv_url": "csv"},
                    {"json_url": "json", "csv_url": " "},
                    {"json_url": 123, "csv_url": "csv"}):
            with self.subTest(bad=bad):
                driver = DurableDriver(
                    {"url_prefix": "example.com", "batch_size": 1}, url_records(9),
                    save=lambda _: bad,
                )
                self.assertEqual(driver.run()["status"], "error")
                self.assertEqual(len(driver.named("save_results")), MAX_IN_FLIGHT_ACTIVITIES)
        driver = DurableDriver(
            {"url_prefix": "example.com"}, url_records(1),
            save=lambda payload: {} if "json_files_urls" in payload else {"json_url": "json", "csv_url": "csv"},
        )
        self.assertEqual(driver.run()["status"], "error")
        self.assertEqual(len(driver.named("save_results")), 2)

    def test_actual_result_lengths_override_claimed_metadata(self):
        driver = DurableDriver(
            {"url_prefix": "example.com", "batch_size": 1}, url_records(3),
            process=lambda payload: {
                "results": [] if payload["batch_number"] == 2 else [{"name": "fixture"}],
                "extracted_count": 99999,
            },
        )
        result = driver.run()
        self.assertEqual(result["total_urls_processed"], 3)
        self.assertEqual(result["restaurants_extracted"], 2)
        self.assertEqual(driver.named("save_results")[1]["results"], [])
        names = [item["json_name"] for item in driver.named("save_results")[:-1]]
        self.assertTrue(all(f"_{i}_" in name for i, name in enumerate(names, 1)))

    def test_activity_failures_propagate_without_scheduling_later_groups(self):
        for phase in ("get_urls", "process_url_batch", "save_results"):
            with self.subTest(phase=phase):
                failure = RuntimeError("fixture failure")

                def fail(_):
                    raise failure

                driver = DurableDriver(
                    {"url_prefix": "example.com", "batch_size": 1},
                    failure if phase == "get_urls" else url_records(9),
                    process=fail if phase == "process_url_batch" else None,
                    save=fail if phase == "save_results" else None,
                )
                with self.assertRaisesRegex(RuntimeError, "fixture failure"):
                    driver.run()
                self.assertLessEqual(driver.peak, MAX_IN_FLIGHT_ACTIVITIES)
                self.assertEqual(len(driver.named(phase)), 1 if phase == "get_urls" else 4)
                if phase == "process_url_batch":
                    self.assertEqual(driver.named("save_results"), [])

    def test_replay_uses_recorded_clock_and_one_suffix_across_save_windows(self):
        histories = []
        for year in (2000, 2030):
            clock = mock.Mock()
            clock.now.return_value = datetime(year, 1, 1)
            driver = DurableDriver(
                {"url_prefix": "example.com", "batch_size": 1}, url_records(9)
            )
            with mock.patch.object(orchestrator, "datetime", clock, create=True):
                result = driver.run()
            saves = driver.named("save_results")
            suffixes = {item["json_name"].split("_", 2)[-1] for item in saves[:-1]}
            self.assertEqual(len(suffixes), 1)
            self.assertTrue(saves[-1]["json_name"].endswith(next(iter(suffixes))))
            histories.append(([(task.name, task.payload) for task in driver.calls], result))
        self.assertEqual(histories[0], histories[1])

    def test_domain_extraction_uses_bundled_multilabel_suffix_without_network(self):
        extractor = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)
        driver = DurableDriver({"url_prefix": "www.restaurant.co.uk"}, url_records(1))
        with mock.patch.object(orchestrator, "extract_domain", extractor):
            with mock.patch.object(requests.sessions.Session, "get", side_effect=AssertionError("Network in orchestrator")):
                self.assertEqual(driver.run()["status"], "success")
        self.assertEqual(driver.named("save_results")[0]["container_name"], "restaurant-data-batches")

    def test_real_batch_rejections_preserve_partial_and_empty_results(self):
        body = make_warc()
        bad = {"url": "https://example.test/bad", "length": "invalid"}
        for records, expected_count in (([bad, index_record(len(body))], 1), ([bad], 0)):
            with self.subTest(expected_count=expected_count):
                session, adapter = session_for(StreamResponse(body))
                driver = DurableDriver(
                    {"url_prefix": "example.com"}, records, process=extraction.main
                )
                with mock.patch.object(extraction, "_CrawlSession", return_value=session) as factory:
                    with mock.patch.object(extraction, "check_circuit_breaker", return_value=False):
                        result = driver.run()
                if expected_count:
                    factory.assert_called_once()
                    self.assertTrue(adapter.closed)
                    self.assertEqual(result["total_urls_processed"], len(records))
                    self.assertEqual(result["restaurants_extracted"], 1)
                    self.assertEqual(len(driver.named("save_results")), 2)
                else:
                    factory.assert_not_called()
                    session.close()
                    self.assertEqual(result, {
                        "status": "warning",
                        "message": "No restaurant data extracted from any batch",
                    })
                    self.assertEqual(len(driver.named("save_results")), 1)
                    self.assertEqual(driver.named("save_results")[0]["results"], [])
