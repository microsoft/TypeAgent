// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { getUserDataDir } from "agent-dispatcher/helpers/data";
import { readFileSync } from "node:fs";
import {
    TypeAgentAPIServerConfig,
    TypeAgentAPIWebServer,
} from "./webServer.js";
import { TypeAgentAPIWebSocketServer } from "./webSocketServer.js";
import {
    // BlobServiceClient,
    // BlockBlobClient,
    ContainerClient,
    ContainerListBlobsOptions,
} from "@azure/storage-blob";
// import { DefaultAzureCredential } from "@azure/identity";
import { StopWatch } from "telemetry";
import path from "node:path";
import fs from "node:fs";
import { isDirectoryPath } from "typeagent";
import { TypeAgentStorageProvider } from "./storageProvider.js";
import { AzureStorageProvider } from "./storageProviders/azureStorageProvider.js";
import { AWSStorageProvider } from "./storageProviders/awsStorageProvider.js";
import { WebDispatcher, createWebDispatcher } from "./webDispatcher.js";

export class TypeAgentServer {
    private webDispatcher: WebDispatcher | undefined;
    private webSocketServer: TypeAgentAPIWebSocketServer | undefined;
    private webServer: TypeAgentAPIWebServer | undefined;
    private fileWriteDebouncer: Map<string, number> = new Map<string, number>();
    private storageProvider: TypeAgentStorageProvider | undefined;
    private config: TypeAgentAPIServerConfig;

    constructor(private envPath: string) {
        // typeAgent config
        dotenv.config({ path: this.envPath });

        // web server config
        this.config = JSON.parse(readFileSync("data/config.json").toString());

        const storageProviderMap = {
            azure: AzureStorageProvider,
            aws: AWSStorageProvider,
        };

        // setting storage provider if "provided"
        if (this.config.blobBackupEnabled && this.config.storageProvider) {
            this.storageProvider = new storageProviderMap[
                this.config.storageProvider
            ]();
        }
    }

    async start() {
        // restore & enable session backup?
        if (this.config.blobBackupEnabled && this.storageProvider) {
            const sw = new StopWatch();
            await this.syncFromProvider();
            this.startLocalStorageBackup();
            sw.stop("Downloaded Session Backup");
            /*
            if (
                this.storageAccount !== undefined &&
                this.storageAccount.length > 0 &&
                this.containerName != undefined &&
                this.containerName.length > 0
            ) {
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
            */
        }

        this.webDispatcher = await createWebDispatcher();
        // web server
        this.webServer = new TypeAgentAPIWebServer(this.config);
        this.webServer.start();

        // websocket server
        this.webSocketServer = new TypeAgentAPIWebSocketServer(
            this.webServer.server,
            this.webDispatcher.connect,
        );
    }

    stop() {
        this.webServer?.stop();
        this.webSocketServer?.stop();
        this.webDispatcher?.close();
    }

    /**
     * Downloads from session data blob storage to the local session store
     */
    /*
    async syncBlobStorage() {
        const blobServiceClient = new BlobServiceClient(
            this.accountURL,
            new DefaultAzureCredential(),
        );

        const containerClient: ContainerClient =
            blobServiceClient.getContainerClient(this.containerName!!);

        await this.findBlobs(containerClient);
    }*/

    async syncFromProvider() {
        if (!this.storageProvider) {
            console.log("No storage provider found");
            return;
        }
        const remoteFiles = await this.storageProvider.listRemoteFiles();
        for (const remoteFile of remoteFiles) {
            try {
                console.log("Syncing file: ", remoteFile);
                const localPath = path.join(getUserDataDir(), remoteFile);
                if (!fs.existsSync(localPath)) {
                    await this.storageProvider.downloadFile(
                        remoteFile,
                        localPath,
                    );
                    console.log(`Downloaded ${remoteFile} to ${localPath}`);
                }
            } catch (e) {
                console.log("Error syncing file: ", remoteFile, e);
            }
        }
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
                try {
                    const localPath: string = path.join(
                        getUserDataDir(),
                        fileName,
                    );

                    if (!this.storageProvider) {
                        console.log(
                            `Failed to upload ${fileName} to provider, no storage provider found`,
                        );
                        return;
                    }
                    await this.storageProvider.uploadFile(localPath, fileName);
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
