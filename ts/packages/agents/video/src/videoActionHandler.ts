// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    ActionResult,
    ActionResultSuccess,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromError,
    createActionResultFromHtmlDisplayWithScript,
} from "@typeagent/agent-sdk/helpers/action";
import { openai, VideoGenerationJob } from "aiclient";
import { CreateVideoAction, VideoAction } from "./videoActionSchema.js";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { randomBytes } from "crypto";

export function instantiate(): AppAgent {
    return {
        executeAction: executeVideoAction,
    };
}

type VideoActionContext = {
    store: undefined;
};

async function executeVideoAction(
    action: AppAction,
    context: ActionContext<VideoActionContext>,
) {
    let result = await handleVideoAction(action as VideoAction, context);
    return result;
}

async function handleVideoAction(
    action: VideoAction,
    videoContext: ActionContext<VideoActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "createVideoAction":
            const createVideoAction: CreateVideoAction =
                action as CreateVideoAction;
            console.log(createVideoAction);
            videoContext.actionIO.setDisplay({
                type: "html",
                content: `
                <div style="loading-container">
                <div class="loading"><div class="loading-inner first"></div><div class="loading-inner second"></div><div class="loading-inner third"></div></div>
                <div class="generating">Generating</div>
                </div>`,
            });

            const videoModel = openai.createVideoModel();
            const response = await videoModel.generateVideo(
                createVideoAction.parameters.caption,
                1,
                5,
                1920,
                1080
            );

            if (response.success) {
                displayStatus("Video generation request accepted...processing.", videoContext);

                result = createVideoPlaceHolder(response.data)
                // const videoJob: VideoGenerationJob = response.data;
                // let status = "";
                // let waitResponse: Response | undefined = undefined;
                // const statusUrl = `${videoJob.endpoint!.origin}/openai/v1/video/generations/jobs/${videoJob.id}?api-version=${videoJob.endpoint!.searchParams.get("api-version")}`;
                // let i = 1;
                // while (status !== "succeeded" && status !== "failed") {
                //     await new Promise((resolve) => setTimeout(resolve, 5000));
                //     waitResponse = await fetch(statusUrl, { headers: videoJob.headers! });
                //     const wr: any = await waitResponse.json();
                //     status = wr.status;
                //     displayStatus(`Waiting (${i++ * 5} seconds):`, wr.status);
                // }                

                // if (!waitResponse || waitResponse.status !== 200) {
                //     result = createActionResult(
                //         `Failed to generate the requested video. ${waitResponse?.statusText}`,
                //     );
                // } else {
                //    result = createActionResult("done!");
                // }
            } else {
                return createActionResultFromError(response.message);
            }

            // if (!response.success) {
            //     result = createActionResult(
            //         `Failed to generate the requested video. ${response.message}`,
            //     );
            // } else {
            //     result = createVideoPlaceHolder(response.data)
            // }
            break;
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

function createVideoPlaceHolder(videoJob: VideoGenerationJob): ActionResultSuccess {

    if (videoJob.endpoint === undefined) {
        return createActionResult(
            `Failed to generate the requested video. No endpoint returned.`,
        );
    }

    const statusUrl = `${videoJob.endpoint.origin}/openai/v1/video/generations/jobs/${videoJob.id}?api-version=${videoJob.endpoint.searchParams.get("api-version")}`;
    //const videoUrl = `${endpoint}openai/v1/video/generations/${videoJob.generationId}/content/video${params}`;
    const hash: string = randomBytes(4).readUInt32LE(0).toString();
    //const outputFilename: string = ''
    const jScript: string = `
    <script>
        async function pollVideo_${hash}() {
            const container = document.getElementById("video_div_${hash}");
            const jobId = "${videoJob.id}";
            console.log("⏳ Polling job status for ID:", jobId);

            let status = "";
            while (status !== "succeeded" && status !== "failed") {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const statusResponse = await fetch("${statusUrl}", { headers: ${JSON.stringify(videoJob.headers)} });
                const statusData = await statusResponse.json();
                console.log("Waiting..." + JSON.stringify(statusData, null, 2));
                status = statusData.status;
                console.log("Status:", status);
            }

            const response = await fetch("${statusUrl}", { headers: ${JSON.stringify(videoJob.headers)} });
            console.log(response);
            if (status === "succeeded") {
                const generations = response.data.generations ?? [];
                if (generations.length > 0) {
                    console.log("✅ Video generation succeeded.");
                    const videoResponse = await fetch(videoUrl, { headers: ${JSON.stringify(videoJob.headers)} });
                    if (videoResponse.ok) {
                        const videoBlob = await videoResponse.blob();
                        const videoObjectURL = URL.createObjectURL(videoBlob);

                        // Create and configure video element
                        const videoElement = document.createElement("video");
                        videoElement.src = videoObjectURL;
                        videoElement.controls = true;
                        videoElement.width = 640; // optional
                        videoElement.height = 360; // optional
                        videoElement.autoplay = false;

                        // Append to container
                        container.appendChild(videoElement);
                        console.log("🎥 Video added to the page.");
                    } else {
                        console.log("❌ Failed to retrieve video content.");
                    }
                } else {
                    console.log("⚠️ Status is succeeded, but no generations were returned.");
                }
            } else {
                console.log("❌ Video generation failed.");
                console.log(JSON.stringify(response.data, null, 4));
            }
        }
        
        pollVideo_${hash}();
    </script>
    `;

    return createActionResultFromHtmlDisplayWithScript(`<div id="video_div_${hash}" class="ai-video-container"></div>` + jScript);
}