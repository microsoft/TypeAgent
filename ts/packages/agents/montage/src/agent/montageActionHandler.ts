// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    //Storage,
} from "@typeagent/agent-sdk";
import { ChildProcess, fork } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MontageAction } from "./montageActionSchema.js";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import * as im from "image-memory";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMontageContext,
        updateAgentContext: updateMontageContext,
        executeAction: executeMontageAction,
        //validateWildcardMatch: markdownValidateWildcardMatch,
    };
}

type MontageActionContext = {
    imageIndexName: string | undefined;
    imageCollection: im.ImageCollection | undefined;
    viewProcess: ChildProcess | undefined;
};

async function executeMontageAction(
    action: AppAction,
    context: ActionContext<MontageActionContext>,
) {
    let result = await handleMontageAction(action as MontageAction, context);
    return result;
}

// async function markdownValidateWildcardMatch(
//     action: AppAction,
//     context: SessionContext<MarkdownActionContext>,
// ) {
//     return true;
// }

async function initializeMontageContext() {    
    return {};
}

async function updateMontageContext(
    enable: boolean,
    context: SessionContext<MontageActionContext>,
): Promise<void> {
    if (enable) {

        // TODO: load image index?

        // if (!context.agentContext.currentFileName) {
        //     context.agentContext.currentFileName = "live.md";
        // }

        // const storage = context.sessionStorage;
        // const fileName = context.agentContext.currentFileName;

        // if (!(await storage?.exists(fileName))) {
        //     await storage?.write(fileName, "");
        // }

        if (!context.agentContext.imageCollection) {
            const indexPath = "f:\pictures_index";
            context.agentContext.imageCollection = await im.ImageCollection.readFromFile(path.dirname(indexPath), path.basename(indexPath, path.extname(indexPath)));
        }

        if (!context.agentContext.viewProcess) {
            //const fullPath = await getFullMarkdownFilePath(fileName, storage!);
            //if (fullPath) {
            //    process.env.MARKDOWN_FILE = fullPath;
                context.agentContext.viewProcess =
                    await createViewServiceHost();
            //}
        }
    } else {
        // shut down service
        if (context.agentContext.viewProcess) {
            context.agentContext.viewProcess.kill();
        }
    }
}

// async function getFullMarkdownFilePath(fileName: string, storage: Storage) {
//     const paths = await storage?.list("", { fullPath: true });
//     const candidates = paths?.filter((item) => item.endsWith(fileName!));

//     return candidates ? candidates[0] : undefined;
// }

async function handleMontageAction(
    action: MontageAction,
    actionContext: ActionContext<MontageActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    //const agent = await createMarkdownAgent("GPT_4o");
    //const storage = actionContext.sessionContext.sessionStorage;

    switch (action.actionName) {
        case "listPhotoAction": {
            // if (!action.parameters.name) {
            //     result = createActionResult(
            //         "Document could not be created: no name was provided",
            //     );
            // } else {
                result = createActionResult("Listing photos ...");

                // const newFileName = action.parameters.name.trim() + ".md";
                // actionContext.sessionContext.agentContext.currentFileName =
                //     newFileName;

                // if (!(await storage?.exists(newFileName))) {
                //     await storage?.write(newFileName, "");
                // }

                let images: string[] | undefined = [];
                if (actionContext.sessionContext.agentContext.viewProcess) {
                    // const fullPath = await getFullMarkdownFilePath(
                    //     newFileName,
                    //     storage!,
                    // );

                    // TODO: get all image entities from knowpro, get their paths and send that across the wire
                    images = actionContext.sessionContext.agentContext.imageCollection?.messages.map((img) => img.metadata.img.fileName);

                    // TODO: update project state with this action

                    actionContext.sessionContext.agentContext.viewProcess.send({
                        type: "listPhotos",
                        files: images,
                    });
                }
                result = createActionResult(`Showing ${images?.length} images.`);
            //}
            break;
        }
        // case "updateDocument": {
        //     result = createActionResult("Updating document ...");

        //     const filePath = `${actionContext.sessionContext.agentContext.currentFileName}`;
        //     let markdownContent;
        //     if (await storage?.exists(filePath)) {
        //         markdownContent = await storage?.read(filePath, "utf8");
        //     }
        //     const response = await agent.updateDocument(
        //         markdownContent,
        //         action.parameters.originalRequest,
        //     );

        //     if (response.success) {
        //         const mdResult = response.data;

        //         // write to file
        //         if (mdResult.content) {
        //             await storage?.write(filePath, mdResult.content);
        //         }
        //         if (mdResult.operationSummary) {
        //             result = createActionResult(mdResult.operationSummary);
        //         } else {
        //             result = createActionResult("Updated document");
        //         }
        //     } else {
        //         console.error(response.message);
        //     }
        //     break;
        // }
    }
    return result;
}

export async function createViewServiceHost() {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<undefined>((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error("Montage view service creation timed out")),
            60000,
        );
    });

    const viewServicePromise = new Promise<ChildProcess | undefined>(
        (resolve, reject) => {
            try {
                const expressService = fileURLToPath(
                    new URL(
                        path.join("..", "./route/route.js"),
                        import.meta.url,
                    ),
                );

                const childProcess = fork(expressService);

                childProcess.send({
                    type: "setFile",
                    filePath: "",
                });

                childProcess.on("message", function (message) {
                    if (message === "Success") {
                        resolve(childProcess);
                    } else if (message === "Failure") {
                        resolve(undefined);
                    }
                });

                childProcess.on("exit", (code) => {
                    console.log("Montage view server exited with code:", code);
                });
            } catch (e: any) {
                console.error(e);
                resolve(undefined);
            }
        },
    );

    return Promise.race([viewServicePromise, timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle);
        return result;
    });
}
