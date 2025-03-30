// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";
import { ChangeTitleAction, FindPhotosAction, RemovePhotosAction, SelectPhotosAction } from "../agent/montageActionSchema.js";
import { PhotoMontage } from "../agent/montageActionHandler.js";

//const eventSource = new EventSource("/events");

export type Message = {
    type: "listPhotos";
}

export type ListPhotosMessage = Message & {
    files: string[];
};

document.addEventListener("DOMContentLoaded", function () {
    const mainContainer = document.getElementById("mainContainer");
    const imgMap: Map<string, HTMLImageElement> = new Map<string, HTMLImageElement>();
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
            const montage = e as PhotoMontage            
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
                // select image by indicies first
                if (msg.parameters.indicies) {
                    for(let i = 0; i < msg.parameters.indicies.length; i++) {
                        mainContainer.children[msg.parameters.indicies[i]].classList.add("selected");
                        selected.add(mainContainer.children[msg.parameters.indicies[i]].getAttribute("path"))
                    }
                }

                // select specifically mentioned images
                selectFiles(msg.parameters.files);

                break;
            }

            case "removePhotos": {
                const msg: RemovePhotosAction = action as RemovePhotosAction;

                // remove all selected images
                if (msg.parameters.selected === "selected" || msg.parameters.selected === "all") {
                    selected.forEach((value: string) => {
                        imgMap.get(value).remove();
                        imgMap.delete(value);                        
                    });
                    selected.clear();                    
                }
                
                // remove unselected images
                if (msg.parameters.selected === "inverse" || msg.parameters.selected === "all") {
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
                            keep.add(mainContainer.children[v].getAttribute("path"));
                        });

                        keep.forEach((img) => {
                            imgMap.get(img).remove();
                            imgMap.delete(img);
                        });

                    } else {
                        // have to start at the end otherwise indexes will be wrong
                        for(let i = msg.parameters.indicies.length - 1; i >= 0 ; i--) {
                            const index = msg.parameters.indicies[i];
                            const file: string | undefined = mainContainer.children[index].getAttribute("path");
                            mainContainer.children[index].remove();

                            imgMap.delete(file);
                            selected.delete(file);
                        }       
                    }             
                }

                // remove specific files
                if (msg.parameters.files) {
                    for(let i = 0; i < msg.parameters.files.length; i++) {

                        if (imgMap.has(msg.parameters.files[i])) {
                            imgMap.get(msg.parameters.files[i]).remove();
                            imgMap.delete(msg.parameters.files[i]);
                        }
                        selected.delete(msg.parameters.files[i]);
                    }                    
                }

                // remove everything
                if (msg.parameters.indicies === undefined 
                    && msg.parameters.files === undefined 
                    && msg.parameters.search_filters === undefined
                    && msg.parameters.selected === undefined) {
                    reset();
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
    }

    /**
     * Adds the supplied images to the main container.
     * @param files The images to add to the main container
     * @param setSelectionState Flag indicating if we shoud set the selection state of the image elements
     */
    function addImages(files: string[] | undefined, setSelectionState: boolean = false) {
        if (files !== undefined) {
            files.forEach(async (f) => {
                if (!imgMap.has(f)) {                            
                    const img: HTMLImageElement = document.createElement("img");
                    img.src = "/thumbnail?path=" + f;
                    img.setAttribute("path", f);
                    imgMap.set(f, img);
        
                    // get the image caption
                    const res = await fetch(`/knowlegeResponse?path=${f}`);
                    const ii = await res.json();
                    img.title = ii.fileName + " - " + ii.altText; 
        
                    mainContainer.append(img);

                    // does it need to be selected or unselected?
                    if (setSelectionState && selected.size > 0) {
                        select(img);
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
            for(let i = 0; i < files.length; i++) {
                if (imgMap.has(files[i])) {
                    imgMap.get(files[i]).classList.add("selected");
                    selected.add(files[i]);
                }
            }
        }

        // remove or add "unselected" as needed
        if (selected.size > 0) {
            for (let i = 0; i < mainContainer.children.length; i++) {
                if (selected.has(mainContainer.children[i].getAttribute("path"))) {
                    mainContainer.children[i].classList.remove("unselected");
                } else {
                    mainContainer.children[i].classList.add("unselected");
                }
            } 
        }
    }

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
function updateFileList(files: Map<string, HTMLImageElement>, selected: Set<string>) {
    // tell the server what images are being show
    fetch("/montageUpdated", {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            title: document.getElementById("title").innerHTML, 
            files: [...files.keys()], 
            selected: [...selected.values()]
        })
    });
}