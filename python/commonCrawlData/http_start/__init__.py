# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import json
import logging
import azure.functions as func
import azure.durable_functions as df
from crawl_limits import (
    DEFAULT_BATCH_SIZE,
    DEFAULT_CRAWL_ID,
    DEFAULT_LIMIT,
    CrawlValidationError,
    validate_crawl_params,
)


async def main(req: func.HttpRequest, starter: str) -> func.HttpResponse:
    """HTTP trigger to start the orchestration"""
    params = {
        name: req.params.get(name)
        for name in ("limit", "batch_size", "crawl_id", "url_prefix")
    }
    for name, default in (
        ("limit", DEFAULT_LIMIT),
        ("batch_size", DEFAULT_BATCH_SIZE),
        ("crawl_id", DEFAULT_CRAWL_ID),
    ):
        if params[name] is None or params[name] == "":
            params[name] = default
    try:
        params = validate_crawl_params(params)
    except CrawlValidationError as exc:
        logging.warning("Rejected Common Crawl request: %s", exc)
        return func.HttpResponse(
            json.dumps({"status": "error", "message": str(exc)}),
            status_code=400,
            mimetype="application/json",
        )

    logging.info(
        "Starting orchestration with limit=%s, crawl_id=%s, batch_size=%s",
        params["limit"],
        params["crawl_id"],
        params["batch_size"],
    )

    client = df.DurableOrchestrationClient(starter)
    instance_id = await client.start_new(
        "orchestrator",
        None,
        params,
    )

    logging.info(f"Started orchestration with ID: {instance_id}")

    return client.create_check_status_response(req, instance_id)
