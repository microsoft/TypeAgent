// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";
import {
    AddPhotosAction,
    ChangeTitleAction,
    RemovePhotosAction,
    SelectPhotosAction,
    SetMontageViewModeAction,
} from "../agent/montageActionSchema.js";
import { PhotoMontage } from "../agent/montageActionHandler.js";
import { Photo } from "./photo";

import registerDebug from "debug";

const debug = registerDebug("typeagent:agent:montage:ui");

export type Message = {
    type: "listPhotos";
};

export type ListPhotosMessage = Message & {
    files: string[];
};

document.addEventListener("DOMContentLoaded", async function () {
    const mainContainer = document.getElementById("mainContainer");
    const imgMap: Map<string, Photo> = new Map<string, Photo>();
    const selected: Set<string> = new Set<string>();
    const montageId = document.getElementById("montageId") as HTMLInputElement;
    let focusedImageIndex = 0;
    const focusedImage = document.getElementById(
        "focusedImage",
    ) as HTMLImageElement;
    let timeout = undefined;
    let preSlideShowViewmode = "grid";

    // setup event source from host source (shell, etc.)
    const eventSource = new EventSource("/events");
    eventSource.onmessage = function (event: MessageEvent) {
        const e = JSON.parse(event.data);
        console.log(e);

        processMessage(e);
    };

    // shortcut title click to change view mode
    document.getElementById("title").onclick = () => {
        if (document.body.classList.contains("focusOn")) {
            document.body.classList.remove("focusOn");
            document.body.classList.add("focusOff");
        } else {
            document.body.classList.remove("focusOff");
            document.body.classList.add("focusOn");
        }
    };

    /**
     * Processes the supplied message
     * @param msg The message to process
     */
    function processMessage(msg: any) {
        // check to see if we are getting initial data and handle that, otherwise process actions
        if (msg.actionName !== undefined && msg.actionName !== "") {
            processAction(msg);
        } else {
            reset();

            // repopulate
            const montage = msg as PhotoMontage;
            montageId.value = montage.id.toString();
            montage.selected.forEach((value) => selected.add(value));
            setTitle(montage.title);
            addImages(montage.files, true);
        }
    }

    function setViewMode(viewMode: string) {
        switch (viewMode) {
            case "grid": {
                document.body.classList.remove("focusOn");
                document.body.classList.add("focusOff");
                break;
            }

            case "filmstrip": {
                document.body.classList.remove("focusOff");
                document.body.classList.add("focusOn");
                break;
            }

            default: {
                throw new Error("Unknown montage view mode!");
            }
        }
    }

    /**
     * Processes the supplied action
     * @param action The action to process
     */
    function processAction(action) {
        debug(`Processing action: ${JSON.stringify(action)}`);

        switch (action.actionName) {
            case "reset": {
                reset();
                break;
            }

            case "setMontageViewMode": {
                const msg: SetMontageViewModeAction =
                    action as SetMontageViewModeAction;
                preSlideShowViewmode = msg.parameters.viewMode;
                setViewMode(msg.parameters.viewMode);
                break;
            }

            case "startSlideShow": {
                startSlideShow();
                break;
            }

            case "addPhotos": {
                const msg: AddPhotosAction = action as AddPhotosAction;
                addImages(msg.parameters.files);
                break;
            }

            case "changeTitle": {
                const msg: ChangeTitleAction = action as ChangeTitleAction;
                setTitle(msg.parameters.newTitle);
                break;
            }

            case "selectPhotos": {
                const msg: SelectPhotosAction = action as SelectPhotosAction;
                // select image by indices first
                if (msg.parameters.indices) {
                    for (const index of msg.parameters.indices) {
                        // User index is based 1
                        const elm = mainContainer.children[index - 1];
                        debug("Selected", index, elm.getAttribute("path"));
                        elm.classList.add("selected");
                        selected.add(elm.getAttribute("path"));
                    }

                    // unselect anything that's not selected
                    for (let i = 0; i < mainContainer.children.length; i++) {
                        const elm = mainContainer.children[i];
                        if (!elm.classList.contains("selected")) {
                            elm.classList.add("unselected");
                        }
                    }
                }

                // select specifically mentioned images
                selectFiles(msg.parameters.files);

                break;
            }

            case "removePhotos": {
                const msg: RemovePhotosAction = action as RemovePhotosAction;

                // remove all selected images
                if (
                    msg.parameters.selected === "selected" ||
                    msg.parameters.selected === "all"
                ) {
                    selected.forEach((value: string) => {
                        // clear the focused image if it's being removed
                        if (focusedImage.getAttribute("path") === value) {
                            focusedImage.src = "";
                        }

                        imgMap.get(value).remove();
                        imgMap.delete(value);
                    });
                    selected.clear();
                }

                // remove unselected images
                if (
                    msg.parameters.selected === "inverse" ||
                    msg.parameters.selected === "all"
                ) {
                    imgMap.forEach((value, key) => {
                        if (!selected.has(key)) {
                            value.remove();
                            imgMap.delete(key);

                            // clear the focused image if it's being removed
                            if (focusedImage.getAttribute("path") === key) {
                                focusedImage.src = "";
                            }
                        }
                    });
                }

                // remove by index
                if (msg.parameters.indices) {
                    // reverse index
                    if (msg.parameters.selected === "inverse") {
                        const keep: Set<string> = new Set<string>();
                        msg.parameters.indices.forEach((v) => {
                            keep.add(
                                mainContainer.children[v - 1].getAttribute(
                                    "path",
                                ),
                            );
                        });

                        keep.forEach((imgPath) => {
                            // clear the focused image if it's being removed
                            if (focusedImage.getAttribute("path") === imgPath) {
                                focusedImage.src = "";
                            }

                            imgMap.get(imgPath).remove();
                            imgMap.delete(imgPath);
                        });
                    } else {
                        // have to start at the end otherwise indexes will be wrong
                        for (
                            let i = msg.parameters.indices.length - 1;
                            i >= 0;
                            i--
                        ) {
                            const index = msg.parameters.indices[i] - 1;
                            const file: string | undefined =
                                mainContainer.children[index].getAttribute(
                                    "path",
                                );
                            mainContainer.children[index].remove();

                            // clear the focused image if it's being removed
                            if (focusedImage.getAttribute("path") === file) {
                                focusedImage.src = "";
                            }

                            imgMap.delete(file);
                            selected.delete(file);
                        }
                    }
                }

                // remove specific files
                if (msg.parameters.files) {
                    for (let i = 0; i < msg.parameters.files.length; i++) {
                        if (imgMap.has(msg.parameters.files[i])) {
                            imgMap.get(msg.parameters.files[i]).remove();
                            imgMap.delete(msg.parameters.files[i]);
                        }

                        // clear the focused image if it's being removed
                        if (
                            focusedImage.getAttribute("path") ===
                            msg.parameters.files[i]
                        ) {
                            focusedImage.src = "";
                        }

                        selected.delete(msg.parameters.files[i]);
                    }
                }

                // remove everything
                if (
                    msg.parameters.indices === undefined &&
                    msg.parameters.files === undefined &&
                    msg.parameters.search_filters === undefined &&
                    msg.parameters.selected === undefined
                ) {
                    reset();
                }

                // update indicies
                for (let i = 0; i < mainContainer.children.length; i++) {
                    mainContainer.children[i].lastElementChild.innerHTML = (
                        i + 1
                    ).toString();
                }

                // clear the focused image
                focusedImage.src = "";

                // Don't break because we want to clear the selection after doing a "remove"
                if (!msg.parameters.selected) {
                    break;
                }
            }

            case "clearSelectedPhotos": {
                selected.clear();

                for (let i = 0; i < mainContainer.children.length; i++) {
                    mainContainer.children[i].classList.remove("selected");
                    mainContainer.children[i].classList.remove("unselected");
                }
                break;
            }
        }

        // let the server know which files are being shown
        updateFileList(imgMap, selected);
    }

    /**
     * Resets the canvas to it's default state
     */
    function reset() {
        selected.clear();
        imgMap.clear();
        mainContainer.innerHTML = "";
        setTitle("");
    }

    /**
     * Adds the supplied images to the main container.
     * @param files The images to add to the main container
     * @param setSelectionState Flag indicating if we shoud set the selection state of the image elements
     */
    function addImages(
        files: string[] | undefined,
        setSelectionState: boolean = false,
    ) {
        if (files !== undefined) {
            files.forEach(async (f, index) => {
                if (!imgMap.has(f)) {
                    // create the image control
                    const img: Photo = new Photo(
                        f,
                        mainContainer.children.length + 1,
                    );

                    // store the reference to the container
                    imgMap.set(f, img);

                    // add the image div to the page
                    mainContainer.append(img.container);

                    // does it need to be selected or unselected?
                    if (setSelectionState && selected.size > 0) {
                        select(img.container);
                    }

                    // make the first image the focused image
                    if (index === 0) {
                        img.setFocusedImage();
                    }
                }
            });
        }
    }

    /**
     * The files to select
     * @param files the files to select
     */
    function selectFiles(files: string[] | undefined) {
        if (files !== undefined) {
            for (let i = 0; i < files.length; i++) {
                if (imgMap.has(files[i])) {
                    imgMap.get(files[i]).container.classList.add("selected");
                    selected.add(files[i]);
                }
            }
        }

        // remove or add "unselected" as needed
        if (selected.size > 0) {
            for (let i = 0; i < mainContainer.children.length; i++) {
                const elm = mainContainer.children[i];
                if (selected.has(elm.getAttribute("path"))) {
                    elm.classList.remove("unselected");
                } else {
                    elm.classList.add("unselected");
                }
            }
        }
    }

    /**
     * Selects or unselects the supplied element
     * @param img - The element to select or unselect
     */
    function select(img: Element) {
        if (selected.has(img.getAttribute("path"))) {
            img.classList.add("selected");
        } else {
            img.classList.add("unselected");
        }
    }

    /**
     * Update the page title
     * @param newTitle The new title to set
     */
    function setTitle(newTitle) {
        const title: HTMLElement = document.getElementById("title");
        title.innerHTML = newTitle;
        document.title = `Montage - ${newTitle}`;
    }

    // get the initial state
    const res = await fetch("/lastMessage", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    });

    if (res.status === 200) {
        const json = await res.json();
        processMessage(json);
    }

    /**
     * Handle key events
     */
    document.addEventListener("keyup", (event) => {
        // left arrow - select the next image as the focused image
        if (event.key === "ArrowLeft") {
            updateFocusedImage(-1);
        }

        // right arrow - select previous image as the focused image
        if (event.key === "ArrowRight") {
            updateFocusedImage(1);
        }
    });

    /**
     * Changes the focused image by shifting the index
     * @param offset - The offset to move the focused image
     */
    function updateFocusedImage(offset: number) {
        // removed the focused image class from the current focused image
        const oldPath =
            mainContainer.children[focusedImageIndex].getAttribute("path");
        imgMap.get(oldPath).unFocusImage();

        focusedImageIndex += offset;

        if (focusedImageIndex < 0) {
            focusedImageIndex = 0;
        } else if (focusedImageIndex >= imgMap.size) {
            focusedImageIndex = imgMap.size - 1;
        }

        // add the focused image class to the new focused image
        const newPath =
            mainContainer.children[focusedImageIndex].getAttribute("path");
        imgMap.get(newPath).setFocusedImage();
    }

    // next/previous images
    document.getElementById("btnPrevious").onclick = () => {
        updateFocusedImage(-1);
    };

    document.getElementById("btnNext").onclick = () => {
        updateFocusedImage(1);
    };

    function startSlideShow() {
        setViewMode("filmstrip");
        const slideshow = document.getElementById("focusContainer");

        slideshow.requestFullscreen().then(() => {
            timeout = setInterval(() => {
                if (focusedImageIndex === imgMap.size - 1) {
                    updateFocusedImage(-imgMap.size);
                } else {
                    updateFocusedImage(1);
                }
            }, 3000); // Change slide every 3 seconds
        });
    }

    // listen for the end of the slide show
    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement) {
            clearInterval(timeout);
            timeout = undefined;
            setViewMode(preSlideShowViewmode);
        }
    });
});

/**
 * Notify the server of the files in the viewer
 */
function updateFileList(files: Map<string, Photo>, selected: Set<string>) {
    // tell the server what images are being show
    fetch("/montageUpdated", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            id: document.getElementById("montageId").getAttribute("value"),
            title: document.getElementById("title").innerHTML,
            files: [...files.keys()],
            selected: [...selected.values()],
        }),
    });
}
