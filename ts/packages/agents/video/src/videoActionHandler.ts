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
import { ImageInPaintItem, openai, VideoGenerationJob } from "aiclient";
import { CreateVideoAction, VideoAction } from "./videoActionSchema.js";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { randomBytes } from "crypto";
import { getMimeType } from "common-utils";

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

            displayStatus("Submitting video generation request...", videoContext);

            const createVideoAction: CreateVideoAction =
                action as CreateVideoAction;
            // TODO: dynamic duration
            const videoModel = openai.createVideoModel();
            const response = await videoModel.generateVideo(
                createVideoAction.parameters.caption,
                1,
                parseInt(createVideoAction.parameters.duration ?? "5"),
                1280,
                720,
                await getInPaintItems(createVideoAction.parameters.relatedFiles, videoContext),
            );

            if (response.success) {
                displayStatus("Video generation request accepted...processing.", videoContext);
                result = createVideoPlaceHolder(response.data)
            } else {
                return createActionResultFromError(response.message);
            }
            break;
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

/**
 * Get inpainting items from the list of related files.
 * @param relatedFiles The list of related files (attachments) the user provided
 * @returns An array of inpainting items or undefined if no valid files are found
 */
async function getInPaintItems(relatedFiles?: string[], context?: ActionContext<VideoActionContext>): Promise<ImageInPaintItem[] | undefined> {

    if (relatedFiles === undefined || relatedFiles.length === 0) {
        return undefined;
    }

    return await Promise.all(relatedFiles.map(async file => {

        let a = await context!.sessionContext.sessionStorage?.read(
            `\\..\\user_files\\${file}`,
            "base64",
        );

        return {
            frame_index: 0,
            type: "image",
            file_name: file,
            crop_bounds: {
                left_fraction: 0,
                top_fraction: 0,
                right_fraction: 1,
                bottom_fraction: 1
            },
            contents: a,
            mime_type: getMimeType(file.substring(file.indexOf(".")))
        };
    }));

}

function createVideoPlaceHolder(videoJob: VideoGenerationJob): ActionResultSuccess {

    if (videoJob.endpoint === undefined) {
        return createActionResult(
            `Failed to generate the requested video. No endpoint returned.`,
        );
    }

    const statusUrl = `${videoJob.endpoint.origin}/openai/v1/video/generations/jobs/${videoJob.id}?api-version=${videoJob.endpoint.searchParams.get("api-version")}`;
    const hash: string = randomBytes(4).readUInt32LE(0).toString();
    const jScript: string = `
    <script>
    
        var ro = new ResizeObserver(entries => {
            for (let e of entries) {
                window.top.postMessage('aivideo_${hash}_' + document.documentElement.scrollHeight, '*');
            }
        });

        ro.observe(document.querySelector('#video_div_${hash}'));

        async function pollVideo_${hash}() {
            const container = document.getElementById("video_div_${hash}");
            const jobId = "${videoJob.id}";
            console.log("⏳ Polling job status for ID:", jobId);            
            
            let i = 1;
            let status = "";
            let statusData = undefined;
            while (status !== "succeeded" && status !== "failed") {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const statusResponse = await fetch("${statusUrl}", { headers: ${JSON.stringify(videoJob.headers)} });

                if (!statusResponse.ok) {
                    // hide the generating graphic
                    container.previousElementSibling.style.display = 'none';

                    console.log("❌ Failed to get job status.");
                    container.innerText = "Failed to get job status. " + statusResponse.statusText;
                    return;
                }

                statusData = await statusResponse.json();
                console.log("Waiting..." + JSON.stringify(statusData, null, 2));
                status = statusData.status;
                container.previousElementSibling.children[1].innerText = "JobID - " + jobId + "<br> Status: " + status + " " + (i++) * 5  + " seconds elapsed";
            }

            // hide the generating graphic
            container.previousElementSibling.style.display = 'none';

            if (status === "succeeded") {
                const generations = statusData.generations ?? [];
                if (generations.length > 0) {
                    console.log("✅ Video generation succeeded.");
                    const video_url = '${videoJob.endpoint.origin}/openai/v1/video/generations/' + generations[0].id + '/content/video?api-version=${videoJob.endpoint.searchParams.get("api-version")}';
                    const videoResponse = await fetch(video_url, { headers: ${JSON.stringify(videoJob.headers)} });
                    if (videoResponse.ok) {
                        container.innerText = '';
                        const videoBlob = await videoResponse.blob();
                        const videoObjectURL = URL.createObjectURL(videoBlob);

                        // Create and configure video element
                        const videoElement = document.createElement("video");
                        videoElement.src = videoObjectURL;
                        videoElement.controls = true;
                        videoElement.width = 100%;
                        videoElement.height = 100%;
                        videoElement.autoplay = true;

                        // Append to container
                        container.appendChild(videoElement);
                        console.log("🎥 Video added to the page.");                        
                    } else {
                        container.innerText = "❌ Failed to retrieve video content.";
                    }
                } else {
                    container.innerText = "⚠️ Status is succeeded, but no generations were returned.";
                }
            } else {
                container.innerHTML = "<div>❌ Video generation failed: " + statusData.failure_reason ?? "" + "</div>";
                console.log(JSON.stringify(statusData, null, 2));
            }
        }
        
        pollVideo_${hash}();
    </script>
    `;

    return createActionResultFromHtmlDisplayWithScript(` 
        <div style="loading-container">
            <div class="loading"><div class="loading-inner first"></div><div class="loading-inner second"></div><div class="loading-inner third"></div></div>
            <div class="generating">Generating</div>
        </div>          
        <div id="video_div_${hash}" class="ai-video-container"></div>`
         + jScript, "An AI generated video of '" + videoJob.prompt + "'");
}