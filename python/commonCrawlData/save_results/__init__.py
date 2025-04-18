# Copyright (c) Microsoft Corporation and Henry Lucco.
# Licensed under the MIT License.

import logging
from urllib.parse import urlparse
import azure.functions as func
import json
import io
import pandas as pd
from azure.storage.blob import BlobServiceClient
import os


container_name = "extracted-data"


def main(params: str) -> dict:
    """Activity function to save combined results to blob storage"""
    global container_name

    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError:
            params = {}

    results = params.get("results", [])
    json_name = params.get("json_name")
    csv_name = params.get("csv_name")
    container_name = params.get("container_name", "extracted-data")
    json_files_urls = params.get("json_files_urls", [])

    if json_files_urls and not results:
        results = merge_json_blobs(json_files_urls)

    logging.info(f"Saving combined results with {len(results)} restaurants")

    ensure_container_exists()
    json_url = upload_to_blob_storage(results, json_name)

    csv_data = create_csv_from_results(results)
    csv_url = upload_to_blob_storage(csv_data, csv_name)

    return {"json_url": json_url, "csv_url": csv_url}


def get_blob_service_client():
    """Get a Blob Service client using the connection string"""
    connection_string = os.environ.get("AzureWebJobsStorage")
    return BlobServiceClient.from_connection_string(connection_string)


def ensure_container_exists():
    """Make sure the blob container exists"""
    blob_service_client = get_blob_service_client()
    try:
        blob_service_client.create_container(container_name)
        logging.info(f"Container '{container_name}' created.")
    except Exception as e:
        # Container may already exist, which is fine
        logging.info(f"Container info: {str(e)}")


def upload_to_blob_storage(data, blob_name):
    """Upload data to Azure Blob Storage"""
    blob_service_client = get_blob_service_client()
    blob_client = blob_service_client.get_blob_client(
        container=container_name, blob=blob_name
    )

    if isinstance(data, str):
        blob_client.upload_blob(data, overwrite=True)
    else:
        blob_client.upload_blob(json.dumps(data, ensure_ascii=False), overwrite=True)

    logging.info(f"Uploaded {blob_name} to blob storage")
    return blob_client.url


def create_csv_from_results(results):
    """Create a simplified CSV with common fields from the schema data"""
    # Extract key fields from the results
    simplified_data = []

    for item in results:
        record = {
            "name": item.get("name", ""),
            "url": item.get("_source_url", ""),
            "type": item.get("@type", ""),
            "price_range": item.get("priceRange", ""),
            "serves_cuisne": item.get("servesCuisine", ""),
        }

        aggregateRating = item.get("aggregateRating", {})
        if isinstance(aggregateRating, dict):
            record["rating"] = aggregateRating.get("ratingValue", "")
            record["review_count"] = aggregateRating.get("reviewCount", "")

        address = item.get("address", {})
        if isinstance(address, dict):
            record["street"] = address.get("streetAddress", "")
            record["city"] = address.get("addressLocality", "")
            record["state"] = address.get("addressRegion", "")
            record["postal_code"] = address.get("postalCode", "")
            record["country"] = address.get("addressCountry", "")

        simplified_data.append(record)

    # Create DataFrame
    df = pd.DataFrame(simplified_data)
    csv_buffer = io.StringIO()
    df.to_csv(csv_buffer, index=False)
    return csv_buffer.getvalue()


def merge_json_blobs(urls):
    blob_service_client = get_blob_service_client()
    merged_data = []

    for url in urls:
        try:
            parsed_url = urlparse(url)
            path_parts = parsed_url.path.lstrip("/").split("/", 1)

            if len(path_parts) != 2:
                logging.error(f"Invalid blob URL format: {url}")
                continue

            source_container, blob_path = path_parts
            container_client = blob_service_client.get_container_client(
                source_container
            )
            blob_client = container_client.get_blob_client(blob_path)

            blob_data = blob_client.download_blob().readall()
            json_data = json.loads(blob_data)

            if isinstance(json_data, list):
                merged_data.extend(json_data)
            else:
                logging.warning(f"{url} does not contain a list. Skipping.")

        except Exception as e:
            logging.error(f"Failed to process {url}: {e}")

    return merged_data
