// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";
import {
    ChangeTitleAction,
    FindPhotosAction,
    RemovePhotosAction,
    SelectPhotosAction,
} from "../agent/montageActionSchema.js";
import { PhotoMontage } from "../agent/montageActionHandler.js";
import { Photo } from "./photo";

import registerDebug from "debug";

const debug = registerDebug("typeagent:agent:montage:ui");
//const eventSource = new EventSource("/events");

export type Message = {
    type: "listPhotos";
};

export type ListPhotosMessage = Message & {
    files: string[];
};

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const imgMap: Map<string, Photo> = new Map<string, Photo>();
    const selected: Set<string> = new Set<string>();

    // setup event source from host source (shell, etc.)
    const eventSource = new EventSource("/events");
    eventSource.onmessage = function (event: MessageEvent) {
        const e = JSON.parse(event.data);
        console.log(e);

        // check to see if we are getting initial data and handle that, otherwise process actions
        if (e.actionName !== undefined && e.actionName !== "") {
            processAction(e);
        } else {
            reset();

            // repopulate
            const montage = e as PhotoMontage;
            montage.selected.forEach((value) => selected.add(value));
            setTitle(montage.title);
            addImages(montage.files, true);
        }
    };

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

            case "findPhotos":
            case "listPhotos": {
                const msg: FindPhotosAction = action as FindPhotosAction;

                addImages(msg.parameters.files);

                break;
            }

            case "changeTitle": {
                const msg: ChangeTitleAction = action as ChangeTitleAction;
                setTitle(msg.parameters.title);
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
                        }
                    });
                }

                // remove by index
                if (msg.parameters.indicies) {
                    // reverse index
                    if (msg.parameters.selected === "inverse") {
                        const keep: Set<string> = new Set<string>();
                        msg.parameters.indicies.forEach((v) => {
                            keep.add(
                                mainContainer.children[v - 1].getAttribute(
                                    "path",
                                ),
                            );
                        });

                        keep.forEach((img) => {
                            imgMap.get(img).remove();
                            imgMap.delete(img);
                        });
                    } else {
                        // have to start at the end otherwise indexes will be wrong
                        for (
                            let i = msg.parameters.indicies.length - 1;
                            i >= 0;
                            i--
                        ) {
                            const index = msg.parameters.indicies[i] - 1;
                            const file: string | undefined =
                                mainContainer.children[index].getAttribute(
                                    "path",
                                );
                            mainContainer.children[index].remove();

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
                        selected.delete(msg.parameters.files[i]);
                    }
                }

                // remove everything
                if (
                    msg.parameters.indicies === undefined &&
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
            files.forEach(async (f) => {
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

    function setTitle(newTitle) {
        const title: HTMLElement = document.getElementById("title");
        title.innerHTML = newTitle;
    }
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
            title: document.getElementById("title").innerHTML,
            files: [...files.keys()],
            selected: [...selected.values()],
        }),
    });
}
