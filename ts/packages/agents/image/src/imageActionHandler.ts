// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    ActionResult,
} from "@typeagent/agent-sdk";
import { StopWatch } from "common-utils";
import { createActionResult, createActionResultFromHtmlDisplay } from "@typeagent/agent-sdk/helpers/action";
import { bing } from "aiclient";
import { Image } from "../../../aiclient/dist/bing.js";
import { randomBytes } from "crypto";
import { CreateImageAction, FindImageAction, ImageAction } from "./imageActionSchema.js";

export function instantiate(): AppAgent {
    return {
        //initializeAgentContext: initializePhotoContext,
        //updateAgentContext: updatePhotoContext,
        executeAction: executePhotoAction,
        //validateWildcardMatch: photoValidateWildcardMatch,
    };
}

type ImageActionContext = {
    store: undefined;
};

async function executePhotoAction(
    action: AppAction,
    context: ActionContext<ImageActionContext>,
) {
    let result = await handlePhotoAction(action as ImageAction, context);
    return result;
}

async function handlePhotoAction(
    action: ImageAction,
    photoContext: ActionContext<ImageActionContext>,
) {
    let result: ActionResult | undefined = undefined;
    switch (action.actionName) {
        case "findImageAction": {
            const findImageAction: FindImageAction = action as FindImageAction; 
            photoContext.actionIO.setDisplay(`Searching for '${findImageAction.parameters.searchTerm}'`);

            const stopWatch = new StopWatch();
            stopWatch.start("IMAGE SEARCH: " + findImageAction.parameters.searchTerm);
            const searchResults: Image[] = await bing.searchImages(findImageAction.parameters.searchTerm, findImageAction.parameters.numImages);
            stopWatch.stop("IMAGE SEARCH");

            photoContext.actionIO.setDisplay(`Found '${findImageAction.parameters.numImages}' results...`);

            console.log(`Found ${searchResults.length} images`);



            // TODO: implement
            // result = createActionResult("Showing camera...");
            // photoContext.actionIO.takeAction("show-camera");

            if (searchResults.length == 0) {
                result = createActionResult(`Unable to find any images for ${findImageAction.parameters.searchTerm}`);
            } else if (searchResults.length == 1) {
                result = createActionResultFromHtmlDisplay(`<img class="chat-input-image" src="${searchResults[0].contentUrl}" />`, "Found 1 image.");
            } else {
                result = createActionResultFromHtmlDisplay(createCarouselForImages(searchResults), `Found ${searchResults.length} images`);
            }
            break;
        }
        case "createImageAction":
            const creeateImageAction: CreateImageAction = action as CreateImageAction; 
            console.log(creeateImageAction);
            photoContext.actionIO.setDisplay(`Searching for '${creeateImageAction.parameters.originalRequest}'`)
            // TODO: implement
            result = createActionResult("generating image");
            break;
        default:
            throw new Error(`Unknown action: ${action.actionName}`);
    }
    return result;
}

function createCarouselForImages(images: Image[]): string {

    const hash: string = randomBytes(4).readUInt32LE(0).toString();
    const jScript: string = `<script type="text/javascript">
    
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
        let slides = document.getElementsByClassName("mySlides");
        let dots = document.getElementsByClassName("dot ${hash}");
        if (n > slides.length) {slideIndex = 1}
        if (n < 1) {slideIndex = slides.length}
        for (i = 0; i < slides.length; i++) {
            slides[i].style.display = "none";
        }
        for (i = 0; i < dots.length; i++) {
            dots[i].className = dots[i].className.replace(" active", "");
        }
        slides[slideIndex-1].style.display = "block";
        dots[slideIndex-1].className += " active";
        }
    };

alert(slideShow_${hash});
</script>`;

    const carousel_start: string = `
    <!-- Slideshow container -->
<div class="slideshow-container">`;
    let carouselDots: string = "";

let carousel: string = "";

images.map((i, index) => {
    carousel += `<div class="mySlides fade ${hash}">
    <div class="numbertext">${index + 1} / ${images.length}</div>
    <img src="${i.contentUrl}" class="chat-input-image">
    <div class="text">Caption Two</div>
  </div>`;

    carouselDots += `<span class="dot ${hash}" onclick="slideShow.currentSlide(${index + 1})"></span>`;
});

  const carousel_end:string = `
  <!-- Next and previous buttons -->
  <a class="prev" onclick="slideShow.plusSlides(-1)">&#10094;</a>
  <a class="next" onclick="slideShow.plusSlides(1)">&#10095;</a>
</div>
<br>
${jScript}
<!-- The dots/circles -->
<div style="text-align:center">
${carouselDots}
</div>`;

return carousel_start + carousel + carousel_end;
}
