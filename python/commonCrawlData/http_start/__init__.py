# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
import azure.functions as func
import azure.durable_functions as df


async def main(req: func.HttpRequest, starter: str) -> func.HttpResponse:
    """HTTP trigger to start the orchestration"""
    client = df.DurableOrchestrationClient(starter)

    # Get parameters from the request
    limit_param = req.params.get("limit")
    limit = int(limit_param) if limit_param else 1000

    crawl_id_param = req.params.get("crawl_id")
    crawl_id = crawl_id_param if crawl_id_param else "2025-13"

    batch_size_param = req.params.get("batch_size")
    batch_size = int(batch_size_param) if batch_size_param else 50

    url_prefix_param = req.params.get("url_prefix")
    if not url_prefix_param:
        return {"status": "error", "message": "No URL search query provided"}

    url_prefix = url_prefix_param

    logging.info(
        f"Starting orchestration with limit={limit}, crawl_id={crawl_id}, batch_size={batch_size}"
    )

    # Start the orchestration
    instance_id = await client.start_new(
        "orchestrator",
        None,
        {
            "limit": limit,
            "crawl_id": crawl_id,
            "batch_size": batch_size,
            "url_prefix": url_prefix,
        },
    )

    logging.info(f"Started orchestration with ID: {instance_id}")

    return client.create_check_status_response(req, instance_id)
