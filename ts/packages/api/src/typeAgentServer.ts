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
import { EnvVars } from "../../aiclient/dist/openai.js";
import { env } from "node:process";
import { BlobServiceClient, ContainerClient, ContainerListBlobsOptions } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { getEnvSetting } from "aiclient";
import { StopWatch } from "../../telemetry/dist/stopWatch.js";
import path from "node:path";
import fs from "node:fs";

export class TypeAgentServer {
    private dispatcher: Dispatcher | undefined;
    private webClientIO: WebAPIClientIO | undefined;
    private webSocketServer: TypeAgentAPIWebSocketServer | undefined;
    private webServer: TypeAgentAPIWebServer | undefined;

    constructor(private envPath: string) {
        // typeAgent config
        dotenv.config({ path: this.envPath });
    }

    async start() {

        // web server config
        const config: TypeAgentAPIServerConfig = JSON.parse(
            readFileSync("data/config.json").toString(),
        );

        // restore session backup?
        if (config.blobBackupEnabled) {
            const sw = new StopWatch();
            sw.start("Downloading Session Backup");

            await this.syncBlobStorage();            

            sw.stop("Downloaded Session Backup");
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
        // get storage account name
        let storageAccount: string = getEnvSetting(env, EnvVars.AZURE_STORAGE_ACCOUNT);
        let containerName: string = getEnvSetting(env, EnvVars.AZURE_STORAGE_CONTAINER, undefined, "sessions");

        const accountURL = `https://${storageAccount}.blob.core.windows.net`;
        const blobServiceClient = new BlobServiceClient(
            accountURL,
            new DefaultAzureCredential()
        );

        const containerClient: ContainerClient = blobServiceClient.getContainerClient(containerName);
        
        await this.listBlobsFlat(containerClient);
        // let i = 1;
        // let iter = containerClient.listBlobsFlat();
        // iter.next().then(async (blobItem: IteratorResult<BlobItem, null>) => {
        //     while (!blobItem.done) {
        //         console.log(`Blob ${i++}: ${blobItem.value.name}`);
        //         blobItem = await iter.next();

        //         const blobClient = containerClient.getBlobClient(blobItem.value!!.name);        
        //         await blobClient.downloadToFile(path.join(getUserProfileDir(), blobItem.value!!.name));
                
        //     }
        // });
    }

    async listBlobsFlat(
        containerClient: ContainerClient
    ): Promise<void> {
        
        const maxPageSize = 100;
    
        // Some options for filtering results
        const listOptions: ContainerListBlobsOptions = {
            includeMetadata: false,
            includeSnapshots: false,
            prefix: '' // Filter results by blob name prefix
        };
    
        for await (const response of containerClient.listBlobsFlat(listOptions).byPage({ maxPageSize })) {
            if (response.segment.blobItems) {
                for (const blob of response.segment.blobItems) {
                    const blobClient = containerClient.getBlobClient(blob.name);
                    const filePath = path.join(getUserDataDir(), blob.name); 
                    let dir = path.dirname(filePath);
                    
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
  
                    if (!fs.existsSync(filePath)) {
                        await blobClient.downloadToFile(filePath, 0, undefined, );                
                    }
                }
            }
        }
    }    
}
