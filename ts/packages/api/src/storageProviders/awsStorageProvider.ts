// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import {
    GetObjectCommand,
    ListObjectsV2Command,
    S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { TypeAgentStorageProvider } from "../storageProvider.js";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export class AWSStorageProvider implements TypeAgentStorageProvider {
    private s3Client: S3Client;
    private bucketName: string;

    constructor() {
        if (!process.env.AWS_S3_BUCKET_NAME) {
            throw new Error("AWS_S3_BUCKET_NAME not set");
        }

        if (!process.env.AWS_S3_REGION) {
            throw new Error("AWS_S3_REGION not set");
        }

        if (!process.env.AWS_ACCESS_KEY_ID) {
            throw new Error("AWS_ACCESS_KEY_ID not set");
        }

        if (!process.env.AWS_SECRET_ACCESS_KEY) {
            throw new Error("AWS_SECRET_ACCESS_KEY not set");
        }

        this.bucketName = process.env.AWS_S3_BUCKET_NAME;
        this.s3Client = new S3Client({
            region: process.env.AWS_S3_REGION,
        });

        console.log("AWSStorageProvider initialized");
    }

    async listRemoteFiles(prefix?: string): Promise<string[]> {
        const results: string[] = [];
        let continueToken: string | undefined = undefined;

        do {
            const command = new ListObjectsV2Command({
                Bucket: this.bucketName,
                Prefix: prefix,
                ContinuationToken: continueToken,
            });
            const response = await this.s3Client.send(command);

            if (response.Contents) {
                for (const content of response.Contents) {
                    if (content.Key) {
                        results.push(content.Key);
                    }
                }
            }
        } while (continueToken);

        return results;
    }

    async downloadFile(remotePath: string, localPath: string): Promise<void> {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: remotePath,
        });

        const commandResponse = await this.s3Client.send(command);
        const bodyStream = commandResponse.Body;

        if (bodyStream) {
            const dirName = path.dirname(localPath);
            if (!fs.existsSync(dirName)) {
                fs.mkdirSync(dirName, { recursive: true });
            }

            const writeStream = fs.createWriteStream(localPath);

            await new Promise<void>((resolve, reject) => {
                (bodyStream as Readable)
                    .pipe(writeStream)
                    .on("finish", () => resolve())
                    .on("error", (err: Error) => {
                        console.log("Error downloading file: ", err);
                        reject(err);
                    });
            });
        }
    }

    async uploadFile(localPath: string, remotePath: string): Promise<void> {
        const resolvedPath = path.resolve(localPath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`File does not actually exist at ${resolvedPath}`);
        }

        const fileStream = fs.createReadStream(localPath);

        const upload = new Upload({
            client: this.s3Client,
            params: {
                Bucket: this.bucketName,
                Key: remotePath,
                Body: fileStream,
            },
        });

        try {
            await upload.done();
            // console.log("upload complete: ", result);
        } catch (e) {
            console.log("error", e);
        }
    }
}
