// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

export interface TypeAgentStorageProvider {
    /**
     * Lists remote files (possibly under a prefix or "folder path" if the
     * provider supports a hierarchical structure).
     *
     * @param prefix Optional prefix to filter the remote file listing.
     * @returns An array of file paths/names in the remote store.
     */
    listRemoteFiles(prefix?: string): Promise<string[]>;

    /**
     * Downloads a remote file from the storage provider to a local path.
     *
     * @param remotePath The path or key of the file in the remote store.
     * @param localPath  The local file path where the file will be saved.
     */
    downloadFile(remotePath: string, localPath: string): Promise<void>;

    /**
     * Uploads a local file to the storage provider.
     *
     * @param localPath  The path of the local file to upload.
     * @param remotePath The path or key of the file in the remote store.
     */
    uploadFile(localPath: string, remotePath: string): Promise<void>;
}
