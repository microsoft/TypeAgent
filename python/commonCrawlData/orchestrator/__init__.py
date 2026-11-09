# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
import azure.durable_functions as df
import tldextract
from crawl_limits import (
    MAX_ACTIVITY_CALLS,
    MAX_BATCHES,
    MAX_IN_FLIGHT_ACTIVITIES,
    MAX_URLS,
    CrawlValidationError,
    validate_crawl_params,
)


extract_domain = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)


def _error(message):
    logging.error("Common Crawl orchestration rejected: %.200s", message)
    return {"status": "error", "message": message}


def _valid_saved_urls(result):
    return isinstance(result, dict) and all(
        isinstance(result.get(key), str) and result[key].strip()
        for key in ("json_url", "csv_url")
    )


def orchestrator_function(context: df.DurableOrchestrationContext):
    """Orchestrator function that coordinates the extraction of restaurant schema.org data"""
    try:
        params = validate_crawl_params(context.get_input())
    except CrawlValidationError as exc:
        return _error(str(exc))
    batch_size = params["batch_size"]
    url_prefix = params["url_prefix"]

    urls = yield context.call_activity(
        "get_urls",
        {
            "limit": params["limit"],
            "crawl_id": params["crawl_id"],
            "url_prefix": url_prefix,
        },
    )

    if not isinstance(urls, list):
        return _error("Index activity must return a list")
    if len(urls) > params["limit"] or len(urls) > MAX_URLS:
        return _error("Index activity returned more records than the crawl limit")
    if any(not isinstance(record, dict) for record in urls):
        return _error("Index activity records must be objects")
    if not urls:
        return _error(f"No {url_prefix} URLs found")

    batch_count = (len(urls) + batch_size - 1) // batch_size
    if batch_count > MAX_BATCHES or 2 * batch_count + 2 > MAX_ACTIVITY_CALLS:
        return _error("Crawl exceeds its activity budget")

    logging.info("Split %s URLs into %s batches", len(urls), batch_count)

    batch_results = []
    extracted_count = 0
    for start in range(0, batch_count, MAX_IN_FLIGHT_ACTIVITIES):
        tasks = []
        for i in range(start, min(start + MAX_IN_FLIGHT_ACTIVITIES, batch_count)):
            batch = urls[i * batch_size : (i + 1) * batch_size]
            tasks.append(
                context.call_activity(
                    "process_url_batch",
                    {
                        "batch": batch,
                        "batch_number": i + 1,
                        "total_batches": batch_count,
                    },
                )
            )
        window_results = yield context.task_all(tasks)
        for i, result in enumerate(window_results, start):
            if not isinstance(result, dict) or not isinstance(
                result.get("results"), list
            ):
                return _error("Processing activity must return a results list")
            results = result["results"]
            input_count = min(batch_size, len(urls) - i * batch_size)
            if len(results) > input_count or any(
                not isinstance(record, dict) for record in results
            ):
                return _error("Processing activity returned invalid or excessive results")
            batch_results.append(results)
            extracted_count += len(results)

    timestamp = context.current_utc_datetime.strftime("%Y%m%d_%H%M%S")
    parsed_url = extract_domain(url_prefix)
    batches_container_name = f"{parsed_url.domain}-data-batches"
    combined_container_name = f"{parsed_url.domain}-data"

    batch_json_urls = []
    for start in range(0, batch_count, MAX_IN_FLIGHT_ACTIVITIES):
        save_tasks = []
        for i in range(start, min(start + MAX_IN_FLIGHT_ACTIVITIES, batch_count)):
            save_tasks.append(
                context.call_activity(
                    "save_results",
                    {
                        "results": batch_results[i],
                        "json_name": f"{parsed_url.domain}_{i + 1}_{timestamp}.json",
                        "csv_name": f"{parsed_url.domain}_{i + 1}_{timestamp}.csv",
                        "container_name": batches_container_name,
                    },
                )
            )
        window_saves = yield context.task_all(save_tasks)
        for result in window_saves:
            if not _valid_saved_urls(result):
                return _error("Save activity must return nonempty JSON and CSV URLs")
            batch_json_urls.append(result["json_url"])

    logging.info(
        "Saved %s batch results to %s", len(batch_json_urls), batches_container_name
    )
    if extracted_count:
        combined_json_name = f"{parsed_url.domain}_combined_{timestamp}.json"
        combined_csv_name = f"{parsed_url.domain}_combined_{timestamp}.csv"

        # Call activity to save combined results
        save_result = yield context.call_activity(
            "save_results",
            {
                "json_files_urls": batch_json_urls,
                "json_name": combined_json_name,
                "csv_name": combined_csv_name,
                "container_name": combined_container_name,
            },
        )
        if not _valid_saved_urls(save_result):
            return _error("Combined save must return nonempty JSON and CSV URLs")

        return {
            "status": "success",
            "total_urls_processed": len(urls),
            "restaurants_extracted": extracted_count,
            "combined_json_url": save_result["json_url"],
            "combined_csv_url": save_result["csv_url"],
        }
    else:
        return {
            "status": "warning",
            "message": "No restaurant data extracted from any batch",
        }


main = df.Orchestrator.create(orchestrator_function)
