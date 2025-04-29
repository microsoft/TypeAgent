// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SemanticRef,
    createKnowledgeModel,
} from "knowpro";
import {
    conversation as kpLib,
    image,
} from "knowledge-processor";
import fs from "node:fs";
import path from "node:path";
import { isImageFileType } from "common-utils";
import { ChatModel } from "aiclient";
import { isDirectoryPath } from "typeagent";
import registerDebug from "debug";
import { ImageCollection } from "./imageCollection.js";
import { Image, ImageMeta } from "./imageMeta.js";

const debug = registerDebug("typeagent:image-memory");

/**
 * Indexes the supplied image or images in the supplied folder.
 *
 * @param imagePath - The path to the image file or a folder containing images
 * @param cachePath - The root cache path, if not specified image path is used
 * @param cachePath - The root cache path, if not specified image path is used
 * @param recursive - A flag indicating if the search should include subfolders
 * @returns - The imported images as an image collection.
 */
export async function importImages(
    imagePath: string,
    cachePath: string | undefined,
    recursive: boolean = true,
    callback?: (text: string, count: number, max: number) => void,
): Promise<ImageCollection> {
    let isDir = isDirectoryPath(imagePath);

    if (!fs.existsSync(imagePath)) {
        throw Error(
            `The supplied file or folder '${imagePath}' does not exist.`,
        );
    }

    if (cachePath !== undefined) {
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath);
        }
    } else {
        cachePath = imagePath;
    }

    // create a model used to extract data from the images
    const chatModel = createKnowledgeModel();

    // the image collection we are accumulating in
    const imgcol = new ImageCollection(path.dirname(imagePath), []);

    if (isDir) {
        await indexImages(
            imagePath,
            cachePath,
            recursive,
            chatModel,
            imgcol,
            callback,
        );
    } else {
        const img = await indexImage(imagePath, cachePath, chatModel);
        if (img !== undefined) {
            imgcol.messages.push(img);
        }
    }

    return imgcol;
}

/**
 * Imports images from the supplied folder.
 *
 * @param sourcePath - The folder to import.
 * @param cachePath - The folder to cache the knowledge responses in
 * @param recursive - A flag indicating whether or not subfolders are imported.
 * @param imageCollection - The image collection to add images to.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported images from the supplied folder.
 */
async function indexImages(
    sourcePath: string,
    cachePath: string,
    recursive: boolean,
    chatModel: ChatModel,
    imageCollection: ImageCollection,
    callback?: (
        text: string,
        count: number,
        max: number,
        imgcol: ImageCollection,
    ) => void,
): Promise<Image[]> {
    // load files from the supplied directory
    try {
        const fileNames = await fs.promises.readdir(sourcePath, {
            recursive: true,
        });

        // create the cache path if it doesn't exist
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath);
        }

        // index each image
        for (let i = 0; i < fileNames.length; i++) {
            // ignore thumbnail images
            if (fileNames[i].toLocaleLowerCase().endsWith(".thumbnail.jpg")) {
                console.log(`ignoring '${fileNames[i]}'`);
                continue;
            }

            const fullFilePath: string = path.join(sourcePath, fileNames[i]);

            if (isDirectoryPath(fullFilePath)) {
                imageCollection.messages.push(
                    ...(await indexImages(
                        fullFilePath,
                        path.join(cachePath, fileNames[i]),
                        true,
                        chatModel,
                        imageCollection,
                        callback,
                    )),
                );
            } else {
                // index the image
                const img = await indexImage(
                    fullFilePath,
                    cachePath,
                    chatModel,
                );

                if (img !== undefined) {
                    imageCollection.messages.push(img);
                }

                if (callback && img) {
                    callback(
                        fileNames[i],
                        i,
                        fileNames.length,
                        imageCollection,
                    );
                }
            }
        }
    } catch (error) {
        debug(error);
    }

    return imageCollection.messages;
}

/**
 * Imports the supplied image file (if it's an image)
 *
 * @param fileName - The file to import
 * @param cachePath - The folder to cache the knowledge response in.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported image.
 */
async function indexImage(
    fileName: string,
    cachePath: string,
    chatModel: ChatModel,
): Promise<Image | undefined> {
    if (!fs.existsSync(fileName)) {
        console.log(`Could not find part of the file path '${fileName}'`);
        return;
    } else if (!isImageFileType(path.extname(fileName))) {
        //console.log(`Skipping '${fileName}', not a known image file.`);
        return;
    }

    const img: image.Image | undefined = await image.loadImageWithKnowledge(
        fileName,
        cachePath,
        chatModel,
    );

    if (img !== undefined) {
        return new Image([img.fileName], new ImageMeta(fileName, img!));
    }

    return undefined;
}

/**
 *
 * @param entity The entity to match
 * @param semanticRefs The semantic references in the index
 * @returns True if there's a duplicate, false otherwise
 */
export function isDuplicateEntity(
    entity: kpLib.ConcreteEntity,
    semanticRefs: SemanticRef[],
) {
    for (let i = 0; i < semanticRefs.length; i++) {
        if (
            semanticRefs[i].knowledgeType == "entity" &&
            entity.name ==
                (semanticRefs[i].knowledge as kpLib.ConcreteEntity).name
        ) {
            if (
                JSON.stringify(entity) ===
                JSON.stringify(semanticRefs[i].knowledge)
            ) {
                return true;
            }
        }
    }

    return false;
}
