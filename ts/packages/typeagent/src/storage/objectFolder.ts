// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import { Path } from "../objStream";
import { NameValue, ScoredItem } from "../memory";
import { createTopNList } from "../vector/embeddings";
import { createLazy, insertIntoSorted } from "../lib";

export enum FileNameType {
    Timestamp,
    Tick,
}
export interface ObjectFolderSettings {
    allowSubFolders?: boolean;
    serializer?: (obj: any) => Buffer;
    deserializer?: (buffer: Buffer) => any;
    fileNameType?: FileNameType;
    cacheNames?: boolean | undefined; // Default is true
    useWeakRefs?: boolean | undefined; // Default is false
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
            fileName = name;
            isNewName = !exists(name);
        }

        const filePath = fullPath(fileName);
        if (settings?.serializer) {
            const buffer = settings.serializer(obj);
            await fileSystem.write(filePath, buffer);
        } else {
            await fileSystem.write(filePath, JSON.stringify(obj));
        }
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
                if (names) {
                    const i = names.indexOf(name);
                    if (i >= 0) {
                        names.splice(i, 1);
                    }
                }
            }
        } catch {}
    }

    function exists(name: string): boolean {
        return fileSystem.exists(fullPath(name));
    }

    async function get(name: string): Promise<T | undefined> {
        try {
            const filePath = fullPath(name);
            if (settings?.deserializer) {
                const buffer = await fileSystem.readBuffer(filePath);
                return <T>settings.deserializer(buffer);
            } else {
                const json = await fileSystem.read(filePath);
                return JSON.parse(<string>json);
            }
        } catch (err: any) {
            if (err.code !== "ENOENT") {
                throw err;
            }
        }
        return undefined;
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
        //console.log(`Loading names: ${folderPath}`);
        let names = await fileSystem.readdir(folderPath);
        if (settings?.allowSubFolders) {
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

function generateTickString(timestamp?: Date): string {
    timestamp ??= new Date();
    return timestamp.getTime().toString();
}

const DIR_PREFIX = ".";
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

function removeDirNames(names: string[]): string[] {
    let dirCount = 0;
    // Remove dir names from the file list
    for (let i = 0; i < names.length; ++i) {
        if (isDir(names[i])) {
            dirCount++;
            names[i] = "";
        }
    }
    if (dirCount > 0) {
        let filesOnly: string[] = [];
        for (let i = 0; i < names.length; ++i) {
            if (names[i].length > 0) {
                filesOnly.push(names[i]);
            }
        }
        names = filesOnly;
    }
    return names;
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

function generateMonotonicName(
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

function* createFileNameGenerator(
    nameGenerator: () => string,
    isNameAcceptable: (name: string) => boolean,
): IterableIterator<string> {
    let prevName: string = "";
    while (true) {
        let nextName = nameGenerator();
        if (prevName === nextName && !isNameAcceptable(nextName)) {
            const extendedName = generateMonotonicName(
                1,
                nextName,
                isNameAcceptable,
                4,
            ).name;
            if (!extendedName) {
                continue;
            }
            prevName = nextName;
            nextName = extendedName;
        } else {
            prevName = nextName;
        }
        yield nextName;
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
    removeFile(path: string): Promise<void>;
    copyFile(fromPath: string, toPath: string): Promise<void>;
    copyDir(fromPath: string, toPath: string): Promise<void>;
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
        write: (path, data) => fs.promises.writeFile(path, data),
        readBuffer: (path) => fs.promises.readFile(path),
        read: (path) => fs.promises.readFile(path, "utf-8"),
        removeFile: (path) => fs.promises.unlink(path),
        copyFile,
        copyDir,
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
