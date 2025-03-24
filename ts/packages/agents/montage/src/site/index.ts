// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { SearchInput } from "./searchInput";
import { ChangeTitleAction, FindPhotosAction, RemovePhotosAction, SelectPhotosAction } from "../agent/montageActionSchema.js";

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
        switch (e.actionName) {

            case "findPhotos":
            case "listPhotos": {
                const msg: FindPhotosAction = e as FindPhotosAction;

                if (msg.parameters.files) {
                    msg.parameters.files.forEach(async (f) => {
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
                        }
                    });
                }
                
                break;
            }

            case "changeTitle": {
                const msg: ChangeTitleAction = e as ChangeTitleAction;
                const title: HTMLElement = document.getElementById("title");
                title.innerHTML = msg.parameters.title;
                break;
            }

            case "selectPhotos": {
                const msg: SelectPhotosAction = e as SelectPhotosAction;
                // select image by indicies first
                if (msg.parameters.indicies) {
                    for(let i = 0; i < msg.parameters.indicies.length; i++) {
                        mainContainer.children[msg.parameters.indicies[i]].classList.add("selected");
                        selected.add(mainContainer.children[msg.parameters.indicies[i]].getAttribute("path"))
                    }
                }

                // select specifically mentioned images
                if (msg.parameters.files) {
                    for(let i = 0; i < msg.parameters.files.length; i++) {
                        if (imgMap.has(msg.parameters.files[i])) {
                            imgMap.get(msg.parameters.files[i]).classList.add("selected");
                            selected.add(msg.parameters.files[i]);
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

                break;
            }

            case "removePhotos": {
                const msg: RemovePhotosAction = e as RemovePhotosAction;

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
                    selected.clear();
                    imgMap.clear();
                    mainContainer.innerHTML = "";
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

        // tell the server what images are being show
        fetch("/files", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ files: [...imgMap.keys()]})
        });
    };
});