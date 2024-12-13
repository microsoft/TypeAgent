// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { createDispatcher, Dispatcher, getUserDataDir } from "agent-dispatcher";
import { readFileSync } from "node:fs";
import {
    TypeAgentAPIServerConfig,
    TypeAgentAPIWebServer,
} from "./webServer.js";
import { WebAPIClientIO } from "./webClientIO.js";
import { TypeAgentAPIWebSocketServer } from "./webSocketServer.js";
import { getDefaultAppAgentProviders } from "agent-dispatcher/internal";
import { env } from "node:process";
import {
    BlobServiceClient,
    BlockBlobClient,
    ContainerClient,
    ContainerListBlobsOptions,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { getEnvSetting, openai } from "aiclient";
import { StopWatch } from "telemetry";
import path from "node:path";
import fs from "node:fs";
import { isDirectoryPath } from "typeagent";

export class TypeAgentServer {
    private dispatcher: Dispatcher | undefined;
    private webClientIO: WebAPIClientIO | undefined;
    private webSocketServer: TypeAgentAPIWebSocketServer | undefined;
    private webServer: TypeAgentAPIWebServer | undefined;
    private storageAccount: string;
    private containerName: string;
    private accountURL: string;
    private fileWriteDebouncer: Map<string, number> = new Map<string, number>();

    constructor(private envPath: string) {
        // typeAgent config
        dotenv.config({ path: this.envPath });

        // blob storage config
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
            "sessions",
        );
        this.accountURL = `https://${this.storageAccount}.blob.core.windows.net`;
    }

    async start() {
        // web server config
        const config: TypeAgentAPIServerConfig = JSON.parse(
            readFileSync("data/config.json").toString(),
        );

        // restore & enable session backup?
        if (config.blobBackupEnabled) {
            if (this.storageAccount !== undefined) {
                const sw = new StopWatch();
                sw.start("Downloading Session Backup");

                await this.syncBlobStorage();

                this.startLocalStorageBackup();

                sw.stop("Downloaded Session Backup");
            } else {
                console.warn(
                    `Blob backup enabled but NOT configured.  Missing env var ${openai.EnvVars.AZURE_STORAGE_ACCOUNT}.`,
                );
            }
        }

        // dispatcher
        this.webClientIO = new WebAPIClientIO();
        this.dispatcher = await createDispatcher("api", {
            appAgentProviders: getDefaultAppAgentProviders(),
            explanationAsynchronousMode: true,
            persistSession: true,
            enableServiceHost: true,
            metrics: true,
            clientIO: this.webClientIO,
        });

        // web server
        this.webServer = new TypeAgentAPIWebServer(config);
        this.webServer.start();

        // websocket server
        this.webSocketServer = new TypeAgentAPIWebSocketServer(
            this.webServer.server,
            this.dispatcher,
            this.webClientIO!,
        );
    }

    stop() {
        this.webServer?.stop();
        this.webSocketServer?.stop();
        this.dispatcher?.close();
    }

    /**
     * Downloads from session data blob storage to the local session store
     */
    async syncBlobStorage() {
        const blobServiceClient = new BlobServiceClient(
            this.accountURL,
            new DefaultAzureCredential(),
        );

        const containerClient: ContainerClient =
            blobServiceClient.getContainerClient(this.containerName);

        await this.findBlobs(containerClient);
    }

    /**
     * Enumerates and downloads the blobs for the supplied container client.
     * @param containerClient The container client whose blobs we are enumerating.
     */
    async findBlobs(containerClient: ContainerClient): Promise<void> {
        const maxPageSize = 100;

        // Some options for filtering results
        const listOptions: ContainerListBlobsOptions = {
            includeMetadata: false,
            includeSnapshots: false,
            prefix: "", // Filter results by blob name prefix
        };

        for await (const response of containerClient
            .listBlobsFlat(listOptions)
            .byPage({ maxPageSize })) {
            if (response.segment.blobItems) {
                for (const blob of response.segment.blobItems) {
                    const blobClient = containerClient.getBlobClient(blob.name);
                    const filePath = path.join(getUserDataDir(), blob.name);
                    let dir = path.dirname(filePath);

                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    // only download the file if it doesn't already exist
                    if (!fs.existsSync(filePath)) {
                        await blobClient.downloadToFile(filePath, 0);
                    }
                }
            }
        }
    }

    /**
     * Looks at the local typeagent storage and replicates any file changes to the blob storage
     */
    startLocalStorageBackup() {
        fs.watch(
            getUserDataDir(),
            { recursive: true, persistent: false },
            async (_, fileName) => {
                if (
                    fileName === undefined ||
                    fileName === null ||
                    fileName?.toLowerCase().endsWith(".lock") ||
                    isDirectoryPath(path.join(getUserDataDir(), fileName!!))
                ) {
                    console.log(`Invalid file: ${fileName}`);
                    return;
                }

                // start a debouncer for the file writes
                if (!this.fileWriteDebouncer.has(fileName!!)) {
                    this.fileWriteDebouncer.set(fileName!!, 0);
                }

                // increase refcount
                let refCount: number = this.fileWriteDebouncer.get(
                    fileName!!,
                ) as number;
                this.fileWriteDebouncer.set(fileName!!, ++refCount);

                // debounce the file after some timeout
                this.debounceFileThenUpload(fileName!!);
            },
        );
    }

    /**
     * Debounces the refcount on a file write operation and then uploads the file to blob storage
     * when the refcount is at zero
     * @param fileName The file name to debounce then upload
     */
    debounceFileThenUpload(fileName: string) {
        setTimeout(async () => {
            if (!this.fileWriteDebouncer.has(fileName)) {
                return;
            }

            // drop the file bounce counter by one
            this.fileWriteDebouncer.set(
                fileName,
                this.fileWriteDebouncer.get(fileName)!! - 1,
            );

            // if the file hasn't been touched for the given timeout we can start uploading it
            const debounceCount: number =
                this.fileWriteDebouncer.get(fileName)!!;
            if (debounceCount == 0) {
                const blobServiceClient = new BlobServiceClient(
                    this.accountURL,
                    new DefaultAzureCredential(),
                );

                const containerClient: ContainerClient =
                    blobServiceClient.getContainerClient(this.containerName);

                let blobName = fileName.replace(getUserDataDir(), "");

                // Create blob client from container client
                const blockBlobClient: BlockBlobClient =
                    containerClient.getBlockBlobClient(blobName!!);

                try {
                    const localPath: string = path.join(
                        getUserDataDir(),
                        fileName,
                    );
                    await blockBlobClient.uploadFile(localPath);
                    console.log(`Done uploading ${fileName} to ${blobName}`);
                } catch (e) {
                    console.log(e);
                }

                // remove the file from the debouncer
                this.fileWriteDebouncer.delete(fileName);
            } else {
                this.debounceFileThenUpload(fileName);
            }
        }, 5000);
    }
}
