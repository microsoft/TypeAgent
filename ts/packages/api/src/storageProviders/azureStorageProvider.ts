// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import { DefaultAzureCredential } from "@azure/identity";
import { TypeAgentStorageProvider } from "../storageProvider.js";
import { getEnvSetting, openai } from "aiclient";
import { env } from "node:process";
import {
    BlobServiceClient,
    BlockBlobClient,
    ContainerClient,
    ContainerListBlobsOptions,
} from "@azure/storage-blob";
import path from "node:path";
import fs from "node:fs";
import { getUserDataDir } from "agent-dispatcher/helpers/data";

export class AzureStorageProvider implements TypeAgentStorageProvider {
    private containerName: string | undefined;
    private storageAccount: string | undefined;
    private accountURL: string;
    private blobServiceClient: BlobServiceClient | undefined;

    constructor() {
        this.storageAccount = getEnvSetting(
            env,
            openai.EnvVars.AZURE_STORAGE_ACCOUNT,
            undefined,
            undefined,
        );

        this.containerName = getEnvSetting(
            env,
            openai.EnvVars.AZURE_STORAGE_CONTAINER,
            undefined,
            "",
        );

        // blob storage config
        this.accountURL = `https://${this.storageAccount}.blob.core.windows.net`;
        this.blobServiceClient = new BlobServiceClient(
            this.accountURL,
            new DefaultAzureCredential(),
        );
    }

    async listRemoteFiles(prefix?: string): Promise<string[]> {
        const results: string[] = [];

        if (!this.blobServiceClient) {
            return results;
        }

        const containerClient: ContainerClient =
            this.blobServiceClient.getContainerClient(this.containerName!!);

        // Some options for filtering results
        const listOptions: ContainerListBlobsOptions = {
            includeMetadata: false,
            includeSnapshots: false,
            prefix: "", // Filter results by blob name prefix
        };

        const maxPageSize = 100;

        // List blobs with an optional prefix, page by page if needed
        for await (const response of containerClient
            .listBlobsFlat(listOptions)
            .byPage({ maxPageSize })) {
            if (response.segment.blobItems) {
                for (const blob of response.segment.blobItems) {
                    /*
                    const blobClient = containerClient.getBlobClient(blob.name);
                    const filePath = path.join(getUserDataDir(), blob.name);
                    let dir = path.dirname(filePath);

                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    // only download the file if it doesn't already exist
                    if (!fs.existsSync(filePath)) {
                        await blobClient.downloadToFile(filePath, 0);
                    }*/

                    // may require some tweaking with specifics of
                    // how blob storage handles paths
                    results.push(blob.name);
                }
            }
        }

        return results;
    }

    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        if (!this.blobServiceClient) {
            return;
        }

        const containerClient: ContainerClient =
            this.blobServiceClient.getContainerClient(this.containerName!!);

        const blockBlobClient = containerClient.getBlockBlobClient(remotePath);

        // Ensure local directory structure exists
        const dirName = path.dirname(localPath);
        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }

        // Download the blob to the specified local file
        await blockBlobClient.downloadToFile(localPath);
    }

    async uploadFile(localPath: string, fileName: string): Promise<void> {
        if (!this.blobServiceClient) {
            return;
        }

        const containerClient: ContainerClient =
            this.blobServiceClient.getContainerClient(this.containerName!!);

        let blobName = fileName.replace(getUserDataDir(), "");
        const blockBlobClient: BlockBlobClient =
            containerClient.getBlockBlobClient(blobName!!);

        await blockBlobClient.uploadFile(localPath);
    }
}
