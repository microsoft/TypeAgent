// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { Path, removeFile, renameFileSync } from "../objStream";
import { NameValue, ScoredItem } from "../memory";
import { createTopNList } from "../vector/embeddings";
import { createLazy, insertIntoSorted } from "../lib";
import registerDebug from "debug";

const storageError = registerDebug("typeagent:storage:error");

export enum FileNameType {
    Timestamp,
    Tick,
}

export type ObjectSerializer = (obj: any) => Buffer | string;
export type ObjectDeserializer = (buffer: Buffer) => any;

export interface ObjectFolderSettings {
    allowSubFolders?: boolean;
    serializer?: ObjectSerializer;
    deserializer?: ObjectDeserializer;
    fileNameType?: FileNameType;
    cacheNames?: boolean | undefined; // Default is true
    useWeakRefs?: boolean | undefined; // Default is false
    safeWrites?: boolean | undefined;
}

/**
 * An Abstract Folder for Storing Objects
 * The folder can be implemented over native files OR an abstract file system
 */
export interface ObjectFolder<T> {
    path: Path;

    size(): Promise<number>;
    get(name: string): Promise<T | undefined>;
    put(
        obj: T,
        name?: string,
        onNameAssigned?: (obj: T, name: string) => void,
    ): Promise<string>;
    append(...messages: T[]): Promise<void>;

    remove(name: string): Promise<void>;
    exists(name: string): boolean;

    all(): AsyncIterableIterator<NameValue<T>>;
    newest(): AsyncIterableIterator<NameValue<T>>;
    clear(): Promise<void>;

    allObjects(): AsyncIterableIterator<T>;
    newestObjects(): AsyncIterableIterator<T>;
    allNames(): Promise<string[]>;

    searchObjects(
        maxMatches: number,
        matcher: (nv: NameValue<T>) => number,
    ): Promise<ScoredItem<T>[]>;

    findObject(
        criteria: (nv: NameValue<T>) => boolean,
    ): Promise<NameValue<T> | undefined>;

    getSubFolderNames(): Promise<string[]>;
    getSubFolder<V>(
        name: string | string[],
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<V> | undefined>;
    createSubFolder<V>(
        name: string | string[],
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<V>>;
}

/**
 * Create an object folder. If folder exists, just get it
 * @param folderPath
 * @param settings
 * @param fsys (optional) File System implementation to use
 * @returns
 */
export async function createObjectFolder<T>(
    folderPath: Path,
    settings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<ObjectFolder<T>> {
    const folderSettings = settings ?? {
        allowSubFolders: false,
    };
    const fileSystem = fSys ?? fsDefault();
    const fileNameGenerator = createNameGenerator();
    const fileNames = createLazy<string[]>(
        () => loadFileNames(),
        folderSettings.cacheNames ?? true,
        folderSettings.useWeakRefs ?? false,
    );

    await fileSystem.ensureDir(folderPath);

    return {
        path: folderPath,
        size,
        get,
        put,
        append,
        remove,
        exists,
        all,
        newest,
        clear,
        allObjects,
        newestObjects,
        searchObjects,
        findObject,
        allNames: async () => {
            return fileNames.get();
        },
        getSubFolderNames,
        getSubFolder,
        createSubFolder,
    };

    async function size(): Promise<number> {
        const names = await fileNames.get();
        return names.length;
    }

    async function put(
        obj: T,
        name?: string,
        onNameAssigned?: (obj: T, name: string) => void,
    ): Promise<string> {
        let fileName: string;
        let isNewName: boolean;
        if (name === undefined || name.length === 0) {
            const objFileName = fileNameGenerator.next().value;
            if (onNameAssigned) {
                onNameAssigned(obj, objFileName);
            }
            fileName = objFileName;
            isNewName = true;
        } else {
            validateName(name);
            fileName = name;
            isNewName = !exists(name);
        }

        const filePath = fullPath(fileName);
        await writeObjectToFile(
            filePath,
            obj,
            folderSettings.serializer,
            folderSettings.safeWrites,
            fileSystem,
        );
        if (isNewName) {
            pushName(fileName);
        }
        return fileName;
    }

    async function append(...objects: T[]): Promise<void> {
        for (let obj of objects) {
            await put(obj);
        }
    }

    async function remove(name: string): Promise<void> {
        try {
            const fPath = fullPath(name);
            if (fileSystem.exists(fPath)) {
                await fileSystem.removeFile(fPath);
                const names = fileNames.value;
                if (names && names.length > 0) {
                    const i = names.indexOf(name);
                    if (i >= 0) {
                        names.splice(i, 1);
                    }
                }
            }
        } catch {}
    }

    function exists(name: string): boolean {
        if (!name) {
            return false;
        }
        return fileSystem.exists(fullPath(name));
    }

    async function get(name: string): Promise<T | undefined> {
        if (!name) {
            return undefined;
        }
        validateName(name);
        const filePath = fullPath(name);
        return readObjectFromFile(filePath, settings?.deserializer, fileSystem);
    }

    async function* all(): AsyncIterableIterator<NameValue<T>> {
        const names = await fileNames.get();
        for (let name of names) {
            const value = await get(name);
            if (value) {
                yield { name: name, value: value };
            }
        }
    }

    async function* newest(): AsyncIterableIterator<NameValue<T>> {
        const names = await fileNames.get();
        for (let i = names.length - 1; i >= 0; --i) {
            const name = names[i];
            const value = await get(name);
            if (value) {
                yield { name: name, value: value };
            }
        }
    }

    async function clear(): Promise<void> {
        try {
            await fileSystem.rmdir(folderPath);
            await fileSystem.ensureDir(folderPath);
            return;
        } catch {}

        // Could not rmdir. Manually delete each object
        const names = await fileNames.get();
        for (let name of names) {
            await remove(name);
        }
    }

    async function loadFileNames(): Promise<string[]> {
        let names = await fileSystem.readdir(folderPath);
        if (folderSettings.safeWrites) {
            names = removeHidden(names);
        }
        if (folderSettings.allowSubFolders) {
            names = removeDirNames(names);
        }
        names.sort();
        return names;
    }

    function pushName(name: string): void {
        const names = fileNames.value;
        if (names) {
            insertIntoSorted(names, name, (x, y) =>
                (x as string).localeCompare(y as string),
            );
        }
    }

    async function* allObjects(): AsyncIterableIterator<T> {
        for await (const nv of all()) {
            yield nv.value;
        }
    }

    async function* newestObjects(): AsyncIterableIterator<T> {
        for await (const nv of newest()) {
            yield nv.value;
        }
    }

    async function searchObjects(
        maxMatches: number,
        matcher: (nv: NameValue<T>) => number,
    ): Promise<ScoredItem<T>[]> {
        const topN = createTopNList<T>(maxMatches);
        for await (const nv of newest()) {
            let score = matcher(nv);
            if (score) {
                topN.push(nv.value, score);
            }
        }
        return topN.byRank();
    }

    async function findObject(
        criteria: (nv: NameValue<T>) => boolean,
    ): Promise<NameValue<T> | undefined> {
        for await (const nv of newest()) {
            if (criteria(nv)) {
                return nv;
            }
        }
        return undefined;
    }

    async function getSubFolderNames(): Promise<string[]> {
        const allNames = await fileSystem.readdir(folderPath);
        return getDirNames(allNames);
    }

    async function getSubFolder<V>(
        name: string | string[],
        subFolderSettings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<V> | undefined> {
        subFoldersAllowed();

        const dirPath = typeof name === "string" ? [name] : name;
        const subFolderPath = await getSubFolderPath(dirPath);
        const fullFolderPath = fullPath(subFolderPath);
        if (fileSystem.exists(fullFolderPath)) {
            return await createObjectFolder<V>(
                fullFolderPath,
                subFolderSettings ?? folderSettings,
                fileSystem,
            );
        }
        return undefined;
    }

    async function createSubFolder<V>(
        name: string | string[],
        subFolderSettings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<V>> {
        subFoldersAllowed();

        const dirPath = typeof name === "string" ? [name] : name;
        const subFolderPath = await ensureSubFolders(dirPath);
        return await createObjectFolder<V>(
            fullPath(subFolderPath),
            subFolderSettings ?? folderSettings,
            fileSystem,
        );
    }

    async function ensureSubFolders(dirPath: string[]): Promise<string> {
        let subFolderPath = getSubFolderPath(dirPath);
        const fullSubFolderPath = fullPath(subFolderPath);
        await fileSystem.ensureDir(fullSubFolderPath);
        return subFolderPath;
    }

    function getSubFolderPath(dirPath: string[]): string {
        let subFolderPath: string = "";
        for (let i = 0; i < dirPath.length; ++i) {
            subFolderPath = path.join(subFolderPath, ensureDirName(dirPath[i]));
        }
        return subFolderPath;
    }

    function fullPath(name: string): string {
        return path.join(folderPath, name);
    }

    function subFoldersAllowed(): void {
        if (!folderSettings.allowSubFolders) {
            throw new Error("Subfolders not permitted");
        }
    }

    function createNameGenerator() {
        const fileNameType = settings?.fileNameType ?? FileNameType.Timestamp;
        return createFileNameGenerator(
            fileNameType === FileNameType.Timestamp
                ? generateTimestampString
                : generateTickString,
            (name: string) => {
                return !fileSystem.exists(fullPath(name));
            },
        );
    }
}

/**
 * Generate a monotonic name that is lexically SORTABLE
 * This method uses the current Date to generate a timestamp
 * @returns string
 */
export function generateTimestampString(timestamp?: Date): string {
    timestamp ??= new Date();
    let name = timestamp.toISOString();
    name = name.replace(/[-:.TZ]/g, "");
    return name;
}

export function ensureUniqueObjectName(
    store: ObjectFolder<string>,
    id: string,
): string | undefined {
    if (!store.exists(id)) {
        return id;
    }
    return generateMonotonicName(1, id, (name: string) => {
        return !store.exists(name);
    }).name;
}

function generateTickString(timestamp?: Date): string {
    timestamp ??= new Date();
    return timestamp.getTime().toString();
}

const DIR_PREFIX = ".";
const TEMP_SUFFIX = "~";
const BACKUP_SUFFIX = "^";

export function makeSubDirPath(basePath: string, name: string): string {
    return path.join(basePath, ensureDirName(name));
}

function ensureDirName(name: string): string {
    if (!name.startsWith(DIR_PREFIX)) {
        name = DIR_PREFIX + name;
    }
    return name;
}

function isDir(name: string): boolean {
    return name[0] == DIR_PREFIX;
}

function isHidden(name: string): boolean {
    const lastChar = name[name.length - 1];
    return lastChar === TEMP_SUFFIX || lastChar === BACKUP_SUFFIX;
}

function removeDirNames(names: string[]): string[] {
    return names.filter((d) => !isDir(d));
}

function removeHidden(names: string[]): string[] {
    return names.filter((n) => !isHidden(n));
}

function getDirNames(names: string[]): string[] {
    const dirNames: string[] = [];
    for (const name of names) {
        if (isDir(name)) {
            const actualName = name.substring(1);
            if (actualName.length > 0) {
                dirNames.push(actualName);
            }
        }
    }
    return dirNames;
}

function toTempPath(filePath: string) {
    return filePath + TEMP_SUFFIX;
}
function toBackupPath(filePath: string) {
    return filePath + BACKUP_SUFFIX;
}

function validateName(name: string) {
    if (isHidden(name)) {
        throw new Error(
            `Object names cannot end with $${TEMP_SUFFIX} or ${BACKUP_SUFFIX} `,
        );
    }
}

export function generateMonotonicName(
    counterStartAt: number,
    baseName: string,
    isNameAcceptable: (name: string) => boolean,
    maxDigits: number = 3,
): { name: string | undefined; lastCounter: number } {
    let counter = counterStartAt;
    let name: string | undefined;
    let maxCounter = 10 ^ maxDigits;

    for (; counter < maxCounter; ++counter) {
        name = baseName + intString(counter, maxDigits);
        if (isNameAcceptable(name)) {
            break;
        }
        // Name exists. Try again with next increment
    }
    return {
        name: name,
        lastCounter: counter,
    };
}

export function* createFileNameGenerator(
    nameGenerator: () => string,
    isNameAcceptable: (name: string) => boolean,
): IterableIterator<string> {
    let prevName: string = "";
    while (true) {
        let nextName = nameGenerator();
        if (prevName === nextName || !isNameAcceptable(nextName)) {
            const extendedName = generateMonotonicName(
                1,
                nextName,
                isNameAcceptable,
                4,
            ).name;
            if (!extendedName) {
                continue;
            }
            nextName = extendedName;
        }
        yield nextName;
        prevName = nextName;
    }
}
/**
 * An Abstract File System
 */
export interface FileSystem {
    exists(path: string): boolean;
    ensureDir(folderPath: string): Promise<void>;
    rmdir(folderPath: string): Promise<void>;
    readdir(folderPath: string): Promise<string[]>;
    readFileNames(folderPath: string): Promise<string[]>;
    readDirectoryNames(folderPath: string): Promise<string[]>;
    readBuffer(path: string): Promise<Buffer>;
    read(path: string): Promise<string>;
    write(path: string, data: string | Buffer): Promise<void>;
    removeFile(path: string): Promise<boolean>;
    copyFile(fromPath: string, toPath: string): Promise<void>;
    copyDir(fromPath: string, toPath: string): Promise<void>;
    renameFile(fromPath: string, toPath: string): boolean;
}

const g_fsDefault = createFileSystem();

export function fsDefault() {
    return g_fsDefault;
}

function createFileSystem(): FileSystem {
    return {
        exists: (path) => fs.existsSync(path),
        ensureDir,
        rmdir: (path) => fs.promises.rm(path, { recursive: true, force: true }),
        readdir,
        readFileNames,
        readDirectoryNames,
        write,
        readBuffer: (path) => fs.promises.readFile(path),
        read: (path) => fs.promises.readFile(path, "utf-8"),
        removeFile: (path) => removeFile(path),
        copyFile,
        copyDir,
        renameFile: (from, to) => renameFileSync(from, to),
    };

    async function ensureDir(folderPath: Path): Promise<void> {
        if (!fs.existsSync(folderPath)) {
            await fs.promises.mkdir(folderPath, { recursive: true });
        }
    }

    async function readdir(path: string): Promise<string[]> {
        return await fs.promises.readdir(path);
    }

    async function readFileNames(dirPath: string): Promise<string[]> {
        const fileNames = await fs.promises.readdir(dirPath);
        return fileNames.filter((name) =>
            fs.statSync(path.join(dirPath, name)).isFile(),
        );
    }

    async function readDirectoryNames(dirPath: string): Promise<string[]> {
        const fileNames = await fs.promises.readdir(dirPath);
        return fileNames.filter((name) =>
            fs.statSync(path.join(dirPath, name)).isDirectory(),
        );
    }

    async function write(
        filePath: string,
        data: string | Buffer,
    ): Promise<void> {
        try {
            await fs.promises.writeFile(filePath, data);
        } catch (error: any) {
            logError("fileSystem:write", filePath, error);
            throw error;
        }
    }

    async function copyDir(fromPath: string, toPath: string): Promise<void> {
        const sourceFileNames = await readdir(fromPath);
        for (const fileName of sourceFileNames) {
            const sourcePath = path.join(fromPath, fileName);
            const destPath = path.join(toPath, fileName);
            await fs.promises.copyFile(sourcePath, destPath);
        }
    }

    async function copyFile(
        src: string,
        dest: string,
        mode?: number,
    ): Promise<void> {
        return await fs.promises.copyFile(src, dest, mode);
    }
}

function intString(num: number, minDigits: number): string {
    return num.toString().padStart(minDigits, "0");
}

function logError(where: string, message: string, error: any) {
    const errorText = `ERROR:${where}\n${message}\n${error}`;
    console.log(errorText);
    storageError(errorText);
}

/**
 * Write to a temp file, then rename the file synchronously
 * @param filePath
 * @param data
 */
export async function safeWrite(
    filePath: string,
    data: string | Buffer,
    fSys?: FileSystem | undefined,
): Promise<void> {
    const fileSystem = fSys ?? fsDefault();
    let tempFilePath: string | undefined = toTempPath(filePath);
    let backupFilePath: string | undefined;
    try {
        await fileSystem.write(tempFilePath, data);
        backupFilePath = toBackupPath(filePath);
        // These renames need to be synchronous to ensure atomicity
        if (!fileSystem.renameFile(filePath, backupFilePath)) {
            backupFilePath = undefined; // No backup file created because no filePath exists
        }
        try {
            fileSystem.renameFile(tempFilePath, filePath);
            tempFilePath = undefined;
        } catch (error: any) {
            // Try to name the file back to what it was
            if (backupFilePath) {
                fileSystem.renameFile(backupFilePath, filePath);
                backupFilePath = undefined;
            }
            throw error;
        }
    } catch (error: any) {
        logError("fileSystem:write", filePath, error);
        throw error;
    } finally {
        // Remove all temp files
        if (tempFilePath) {
            await fileSystem.removeFile(tempFilePath);
        }
        if (backupFilePath) {
            await fileSystem.removeFile(backupFilePath);
        }
    }
}

export async function readObjectFromFile<T>(
    filePath: string,
    deserializer: ObjectDeserializer | undefined,
    fSys?: FileSystem,
): Promise<T | undefined> {
    const fileSystem = fSys ?? fsDefault();
    try {
        if (deserializer) {
            const buffer = await fileSystem.readBuffer(filePath);
            if (buffer.length == 0) {
                return undefined;
            }
            return deserializer(buffer);
        } else {
            const json = await fileSystem.read(filePath);
            if (json) {
                return JSON.parse(json);
            }
        }
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            logError("loadObjectFromFile", filePath, err);
        }
    }
    return undefined;
}

export function writeObjectToFile<T>(
    filePath: string,
    obj: T,
    serializer?: ObjectSerializer | undefined,
    safeWrites: boolean = false,
    fSys?: FileSystem,
): Promise<void> {
    const fileSystem = fSys ?? fsDefault();
    const data = serializer ? serializer(obj) : JSON.stringify(obj);
    if (safeWrites) {
        return safeWrite(filePath, data);
    } else {
        return fileSystem.write(filePath, data);
    }
}
