// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    ActionResult,
    ActionResultSuccess,
    ActionTokenUsage,
} from "@typeagent/agent-sdk";
import { downloadImage, getMimeType } from "typechat-utils";
import {
    createActionResult,
    createActionResultFromHtmlDisplayWithScript,
} from "@typeagent/agent-sdk/helpers/action";
import { GeneratedImage, openai } from "@typeagent/aiclient";
import { randomBytes, randomUUID } from "crypto";
import {
    CreateImageAction,
    EditImageAction,
    ImageAction,
} from "./imageActionSchema.js";

export function instantiate(): AppAgent {
    return {
        executeAction: executePhotoAction,
    };
}

type ImageActionContext = {
    store: undefined;
};

async function executePhotoAction(
    action: AppAction,
    context: ActionContext<ImageActionContext>,
) {
    // Per-request token-usage accumulator. The aiclient image-generation
    // API (createImageModel -> generateImage / editImage) does not surface
    // any token/usage stats and the ImageModel has no completionCallback,
    // so usage isn't available without a cross-package aiclient refactor.
    // Report all-zero on success so the agent still participates in the
    // token-reporting contract ("ran, reported no tokens") rather than
    // leaving tokenUsage undefined ("not reported").
    const tokenUsage: ActionTokenUsage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
    };
    let result = await handlePhotoAction(
        action as ImageAction,
        context,
        tokenUsage,
    );
    return result;
}

async function handlePhotoAction(
    action: ImageAction,
    photoContext: ActionContext<ImageActionContext>,
    tokenUsage: ActionTokenUsage,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "createImageAction":
            const createImageAction: CreateImageAction =
                action as CreateImageAction;
            console.log(createImageAction);
            photoContext.actionIO.setDisplay({
                type: "html",
                content: `
                <div style="loading-container">
                <div class="loading"><div class="loading-inner first"></div><div class="loading-inner second"></div><div class="loading-inner third"></div></div>
                <div class="generating">Generating</div>
                </div>`,
            });

            const imageModel = openai.createImageModel();
            const images: GeneratedImage[] = [];
            // limit image creation
            const imageCount: number =
                createImageAction.parameters.numImages > 5
                    ? 5
                    : createImageAction.parameters.numImages;

            let lastError: string = "";
            for (let i = 0; i < imageCount; i++) {
                const r = await imageModel.generateImage(
                    createImageAction.parameters.caption,
                    1,
                    1024,
                    1024,
                );

                if (r.success) {
                    r.data.images.map((image) => {
                        images.push(image);
                    });
                } else {
                    lastError = r.message;
                    console.log(r.message);
                }
            }

            // clear the generating display
            photoContext.actionIO.setDisplay({
                type: "html",
                content: ``,
            });

            if (images.length == 0) {
                result = createActionResult(
                    `Failed to generate the requested image. ${lastError}`,
                );
            } else {
                const urls: string[] = [];
                const captions: string[] = [];
                images.map((i) => {
                    urls.push(i.image_url);
                    captions.push(i.revised_prompt);
                });
                const carousel = createCarouselForImages(urls, captions);
                carousel.tokenUsage = tokenUsage;
                result = carousel;

                // save the generated image in the session store and add the image to the knowledge store
                const id = randomUUID();
                const fileName = `../generated_images/${id.toString()}.png`;
                let saved = false;
                if (urls[0].startsWith("data:")) {
                    // gpt-image-1 returns base64-encoded image data
                    const base64Data = urls[0].substring(
                        urls[0].indexOf(",") + 1,
                    );
                    const buffer = Buffer.from(base64Data, "base64");
                    photoContext.sessionContext.sessionStorage?.write(
                        fileName,
                        buffer,
                    );
                    saved = true;
                } else {
                    saved = await downloadImage(
                        urls[0],
                        fileName,
                        photoContext.sessionContext.sessionStorage!,
                    );
                }
                if (saved) {
                    // add the generated image to the entities
                    result.entities.push({
                        name: fileName.substring(3),
                        type: ["file", "image", "ai_generated"],
                    });
                }
            }
            break;
        case "editImageAction": {
            const editAction = action as EditImageAction;
            result = await handleEditImage(
                editAction,
                photoContext,
                tokenUsage,
            );
            break;
        }
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return result;
}

async function handleEditImage(
    editAction: EditImageAction,
    photoContext: ActionContext<ImageActionContext>,
    tokenUsage: ActionTokenUsage,
): Promise<ActionResult> {
    const { editPrompt, sourceImage } = editAction.parameters;
    if (!sourceImage) {
        return createActionResult(
            "No source image was provided. Please attach the image you'd like to edit.",
        );
    }
    if (!editPrompt) {
        return createActionResult(
            "No edit instruction was provided. Tell me how to transform the image (e.g. 'cartoonize this').",
        );
    }

    photoContext.actionIO.setDisplay({
        type: "html",
        content: `
        <div style="loading-container">
        <div class="loading"><div class="loading-inner first"></div><div class="loading-inner second"></div><div class="loading-inner third"></div></div>
        <div class="generating">Editing</div>
        </div>`,
    });

    // Resolve the source image bytes from session storage. Attachments
    // the user uploaded this turn live under `user_files/`; outputs from
    // prior createImageAction/editImageAction calls live under
    // `generated_images/`. Try both, plus the raw path as supplied.
    const fileName = sourceImage.substring(
        Math.max(sourceImage.lastIndexOf("\\"), sourceImage.lastIndexOf("/")) +
            1,
    );
    const candidates: string[] = [];
    // If the LLM gave us an explicit relative path, honor it first.
    if (sourceImage.includes("/") || sourceImage.includes("\\")) {
        candidates.push(`\\..\\${sourceImage.replace(/\//g, "\\")}`);
    }
    candidates.push(`\\..\\user_files\\${fileName}`);
    candidates.push(`\\..\\generated_images\\${fileName}`);

    let b64: string | undefined;
    let resolvedPath: string | undefined;
    for (const candidate of candidates) {
        try {
            const data = await photoContext.sessionContext.sessionStorage?.read(
                candidate,
                "base64",
            );
            if (data) {
                b64 = data;
                resolvedPath = candidate;
                break;
            }
        } catch {
            // try next candidate
        }
    }
    if (!b64) {
        photoContext.actionIO.setDisplay({ type: "html", content: "" });
        return createActionResult(
            `Could not find source image '${sourceImage}' in session storage. Tried: ${candidates.join(", ")}`,
        );
    }
    const buffer = Buffer.from(b64, "base64");
    // Derive extension from whatever path actually resolved.
    const resolvedName = resolvedPath ?? fileName;
    const dotIdx = resolvedName.lastIndexOf(".");
    const ext = dotIdx >= 0 ? resolvedName.substring(dotIdx) : "";
    const mime = ext ? getMimeType(ext) : "image/png";

    const imageModel = openai.createImageModel();
    if (!imageModel.editImage) {
        photoContext.actionIO.setDisplay({ type: "html", content: "" });
        return createActionResult(
            "Image editing is not supported by the configured image model.",
        );
    }

    const r = await imageModel.editImage(
        buffer,
        mime,
        fileName,
        editPrompt,
        1,
        1024,
        1024,
    );

    photoContext.actionIO.setDisplay({ type: "html", content: "" });

    if (!r.success) {
        return createActionResult(`Failed to edit the image. ${r.message}`);
    }

    const urls: string[] = [];
    const captions: string[] = [];
    r.data.images.map((i) => {
        urls.push(i.image_url);
        captions.push(i.revised_prompt);
    });

    const result = createCarouselForImages(urls, captions);
    result.tokenUsage = tokenUsage;

    // Persist the edited image in the session store, mirroring createImageAction.
    const id = randomUUID();
    const savedFileName = `../generated_images/${id.toString()}.png`;
    let saved = false;
    if (urls[0].startsWith("data:")) {
        const base64Data = urls[0].substring(urls[0].indexOf(",") + 1);
        const editedBuffer = Buffer.from(base64Data, "base64");
        photoContext.sessionContext.sessionStorage?.write(
            savedFileName,
            editedBuffer,
        );
        saved = true;
    } else {
        saved = await downloadImage(
            urls[0],
            savedFileName,
            photoContext.sessionContext.sessionStorage!,
        );
    }
    if (saved) {
        result.entities.push({
            name: savedFileName.substring(3),
            type: ["file", "image", "ai_generated"],
        });
    }
    return result;
}

function createCarouselForImages(
    images: string[],
    captions: string[],
): ActionResultSuccess {
    let literal: string = `There are ${images.length} shown. `;
    const hash: string = randomBytes(4).readUInt32LE(0).toString();
    const jScript: string = `
    <script>
    var slideShow_${hash} = new function()  {
        let slideIndex = 1;
        showSlides(slideIndex);

        // Next/previous controls
        this.plusSlides = function(n) {
        showSlides(slideIndex += n);
        }

        // Thumbnail image controls
        this.currentSlide = function(n) {
        showSlides(slideIndex = n);
        }

        function showSlides(n) {
            let i;
            let slides = document.getElementsByClassName("mySlides ${hash}");
            let dots = document.getElementsByClassName("dot ${hash}");

            if (slides === undefined || slides.length == 0) return;
            if (n > slides.length) {slideIndex = 1}
            if (n < 1) {slideIndex = slides.length}
            for (i = 0; i < slides.length; i++) {
                slides[i].classList.add("slideshow-hidden");
            }
            for (i = 0; i < dots.length; i++) {
                dots[i].classList.remove("active");
            }
            slides[slideIndex-1].classList.remove("slideshow-hidden");
            dots[slideIndex-1].classList.add("active");
        }

        var ro = new ResizeObserver(entries => {
         for (let e of entries) {
            window.top.postMessage('slideshow_${hash}_' + document.getElementById('slideshow_${hash}').scrollHeight, '*');
         }
        });

        ro.observe(document.querySelector('#slideshow_${hash}'));
    };
    </script>`;

    const carousel_start: string = `
    <div id="slideshow_${hash}">
        <!-- Slideshow container -->
    <div class="slideshow-container ${hash}">`;
    let carouselDots: string = "";

    let carousel: string = "";

    images.map((url, index) => {
        carousel += `<div class="mySlides corousel-fade ${hash}">
        <div class="numbertext">${index + 1} / ${images.length}</div>
        <div style="display: flex;justify-content: center;">
        <img src="${url}" class="chat-input-image" alt="${captions[index]}" onerror="if (this.src.indexOf('data:image') != 0) this.width='64px'; this.src = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%202048%202048%22%20width%3D%22150%22%20height%3D%22150%22%3E%0A%20%20%3Cpath%20d%3D%22M1600%201152q93%200%20174%2035t143%2096%2096%20142%2035%20175q0%2093-35%20174t-96%20143-142%2096-175%2035q-93%200-174-35t-143-96-96-142-35-175q0-93%2035-174t96-143%20142-96%20175-35zm-320%20448q0%2066%2025%20124t68%20102%20102%2069%20125%2025q47%200%2092-13t84-40l-443-443q-26%2039-39%2084t-14%2092zm587%20176q26-39%2039-84t14-92q0-66-25-124t-69-101-102-69-124-26q-47%200-92%2013t-84%2040l443%20443zm-774%20125q22%2036%2048%2069t57%2062q-43%208-86%2012t-88%204q-141%200-272-36t-244-104-207-160-161-207-103-245-37-272q0-141%2036-272t104-244%20160-207%20207-161T752%2037t272-37q141%200%20272%2036t244%20104%20207%20160%20161%20207%20103%20245%2037%20272q0%2044-4%2087t-12%2087q-54-59-118-98l4-38q2-19%202-38%200-130-38-256h-362q8%2062%2011%20123t5%20124q-33%203-65%2010t-64%2018q2-69-2-137t-14-138H657q-9%2064-13%20127t-4%20129q0%2065%204%20128t13%20128h446q-37%2059-60%20128H679q8%2037%2023%2089t37%20109%2051%20113%2064%20101%2078%2072%2092%2028q18%200%2035-5t34-14zm739-1261q-38-81-91-152t-120-131-143-104-162-75q36%2049%2064%20105t51%20115%2040%20121%2029%20121h332zm-808-512q-49%200-91%2027t-78%2073-65%20101-51%20113-37%20109-23%2089h690q-8-37-23-89t-37-109-51-113-64-101-78-72-92-28zm-292%2050q-85%2029-162%2074T427%20357%20308%20487t-92%20153h332q12-59%2028-120t39-121%2052-116%2065-105zm-604%20846q0%20130%2038%20256h362q-8-64-12-127t-4-129q0-65%204-128t12-128H166q-38%20126-38%20256zm88%20384q38%2081%2091%20152t120%20131%20143%20104%20162%2075q-36-49-65-105t-51-115-39-121-29-121H216z%22%20%2F%3E%0A%3C%2Fsvg%3E';">
        <div class="image-search-caption">${captions[index]}</div>
        </div>        
    </div>`;

        carouselDots += `<span class="dot ${hash}" onclick="slideShow_${hash}.currentSlide(${index + 1})"></span>`;

        literal += `Image ${index + 1}: ${url}, Caption: ${captions[index]} `;
    });

    const carousel_end: string = `
    <!-- Next and previous buttons -->
    <a class="prev" onclick="slideShow_${hash}.plusSlides(-1)">&#10094;</a>
    <a class="next" onclick="slideShow_${hash}.plusSlides(1)">&#10095;</a>
    </div>
    
    <!-- The dots/circles -->
    <div style="text-align:center; margin: 10px 0px;">
    ${carouselDots}
    </div>    
    </div>`;

    return createActionResultFromHtmlDisplayWithScript(
        carousel_start + carousel + carousel_end + jScript,
        literal,
    );
}
