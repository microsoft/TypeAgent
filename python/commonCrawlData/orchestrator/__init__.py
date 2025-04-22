# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
from urllib.parse import urlparse
import azure.functions as func
import azure.durable_functions as df
from datetime import datetime
import tldextract


def orchestrator_function(context: df.DurableOrchestrationContext):
    """Orchestrator function that coordinates the extraction of restaurant schema.org data"""
    # Get parameters
    params = context.get_input()
    total_limit = params.get("limit", 1000)
    crawl_id = params.get("crawl_id", "2025-13")
    batch_size = params.get("batch_size", 50)
    url_prefix = params.get("url_prefix", "")

    if not url_prefix:
        return {"status": "error", "message": "No URL search query provided"}

    urls = yield context.call_activity(
        "get_urls",
        {"limit": total_limit, "crawl_id": crawl_id, "url_prefix": url_prefix},
    )

    if not urls or len(urls) == 0:
        return {"status": "error", "message": f"No {url_prefix} URLs found"}

    # Process URLs in batches
    batches = []
    for i in range(0, len(urls), batch_size):
        batches.append(urls[i : i + batch_size])

    logging.info(f"Split {len(urls)} URLs into {len(batches)} batches")

    # Process batches in parallel
    tasks = []
    for i, batch in enumerate(batches):
        task = context.call_activity(
            "process_url_batch",
            {
                "batch": batch,
                "batch_number": i + 1,
                "total_batches": len(batches),
            },
        )
        tasks.append(task)

    # Wait for all batches to complete
    batch_results = yield context.task_all(tasks)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    parsed_url = tldextract.extract(url_prefix)
    batches_container_name = f"{parsed_url.domain}-data-batches"
    combined_container_name = f"{parsed_url.domain}-data"

    # split save operations to account for cases where datasets are large
    save_tasks = []
    all_results = []
    for i, batch in enumerate(batch_results):
        if batch and "results" in batch:
            all_results.extend(batch["results"])

            batch_json_name = f"{parsed_url.domain}_{i + 1}_{timestamp}.json"
            batch_csv_name = f"{parsed_url.domain}_{i + 1}_{timestamp}.csv"

            save_task = context.call_activity(
                "save_results",
                {
                    "results": batch["results"],
                    "json_name": batch_json_name,
                    "csv_name": batch_csv_name,
                    "container_name": batches_container_name,
                },
            )

            save_tasks.append(save_task)

    # Wait for all batches to complete
    save_results = yield context.task_all(save_tasks)
    batch_json_urls = []
    for save_result in save_results:
        if save_result:
            batch_json_urls.append(save_result.get("json_url", ""))

    logging.info(f"Saved {len(save_results)} batch results to {batches_container_name}")

    if all_results:
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

        return {
            "status": "success",
            "total_urls_processed": len(urls),
            "restaurants_extracted": len(all_results),
            "combined_json_url": save_result.get("json_url", ""),
            "combined_csv_url": save_result.get("csv_url", ""),
        }
    else:
        return {
            "status": "warning",
            "message": "No restaurant data extracted from any batch",
        }


main = df.Orchestrator.create(orchestrator_function)
