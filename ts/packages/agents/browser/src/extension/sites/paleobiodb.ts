// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentManifest,
    AppAgent,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { PaleoBioDbActions } from "./paleobiodbSchema.mjs";

declare var taxaBrowser: any;
declare var timeScale: any;
declare var navMap: any;
declare var map: any;

function enablePaleoBioDbFilter(time: string, taxa: string) {
    if (time) {
        navMap.filterByTime(time);
        timeScale.goTo(time);
    }

    if (taxa) {
        navMap.filterByTaxon(taxa);
    }

    navMap.refresh("reset");
}

function clearPaleoBioDbFilter(time: boolean, taxa: boolean, all: boolean) {
    if (time || all) {
        const timeFilterControl = document.querySelector(
            "#selectedInterval > button",
        ) as HTMLButtonElement;
        if (timeFilterControl) {
            timeFilterControl.click();
            timeScale.goTo("Phanerozoic");
        }
    }

    if (taxa || all) {
        if (navMap.filters.exist.taxon) {
            navMap.filters.taxa.forEach((f: { name: string; id: any }) => {
                navMap.removeTaxonFilters([f.id]);
            });
        }
    }

    navMap.refresh("reset");
}

function zoomInOnPaleoBioDb() {
    const zoomInControl = document.querySelector(
        "#mapControls > div > div.zoom-in.mapCtrl",
    ) as HTMLDivElement;
    if (zoomInControl) {
        const event = new Event("tap", {
            bubbles: true,
            cancelable: true,
        });
        zoomInControl.dispatchEvent(event);
    }
}

function zoomOutOnPaleoBioDb() {
    const zoomOutControl = document.querySelector(
        "#mapControls > div > div.zoom-out.mapCtrl",
    ) as HTMLDivElement;
    if (zoomOutControl) {
        const event = new Event("tap", {
            bubbles: true,
            cancelable: true,
        });

        zoomOutControl.dispatchEvent(event);
    }
}

function panMapOnPaleoBioDb(direction: string) {
    const center = map.getCenter();
    switch (direction) {
        case "left":
            map.panBy([-200, 0]);
            break;
        case "right":
            map.panBy([200, 0]);
            break;
        case "up":
            map.panBy([0, -200]);
            break;
        case "down":
            map.panBy([0, 200]);
            break;
    }
}

function setMapLocation(latitude: number, longitude: number) {
    const zoomLevel = Math.max(8, map.getZoom());
    navMap.goTo([latitude, longitude], zoomLevel);
    navMap.refresh("reset");
}

function getPrevalentTaxons() {
    let taxonNames: string[] = [];
    const taxonList = document.querySelectorAll<Element>(
        "#graphics > div.col-sm-12.prevalence-row > div > div:nth-child(1) > p",
    );
    taxonList.forEach((el) => {
        taxonNames.push(el.innerHTML.split(" ")[0]);
    });

    return taxonNames;
}

interface Coordinates {
    latitude: number;
    longitude: number;
}

interface NominatimResponse {
    lat: string;
    lon: string;
    display_name?: string;
    place_id?: number;
    // Add other properties as needed
}

async function getLatLong(locationName: string): Promise<Coordinates> {
    const encodedLocation: string = encodeURIComponent(locationName);
    const url: string = `https://nominatim.openstreetmap.org/search?q=${encodedLocation}&format=json&limit=1`;

    try {
        const response: Response = await fetch(url);
        const data: NominatimResponse[] = await response.json();

        if (data && data.length > 0) {
            const { lat, lon } = data[0];
            return {
                latitude: parseFloat(lat),
                longitude: parseFloat(lon),
            };
        } else {
            throw new Error("Location not found");
        }
    } catch (error) {
        console.error(
            "Error fetching coordinates:",
            error instanceof Error ? error.message : String(error),
        );
        throw error;
    }
}

function getExtensionFilePath(fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Set up a one-time listener for the response
        const messageHandler = (event: any) => {
            if (event.data.type === "FILE_PATH_RESULT") {
                window.removeEventListener("message", messageHandler);
                resolve(event.data.result);
            }
        };

        window.addEventListener("message", messageHandler);

        // Send request
        window.postMessage({ type: "GET_FILE_PATH", fileName }, "*");

        // Add timeout
        setTimeout(() => {
            window.removeEventListener("message", messageHandler);
            reject(new Error("Timeout waiting for file path response"));
        }, 5000);
    });
}

function sendResponse(data: any) {
    document.dispatchEvent(
        new CustomEvent("fromPaleoDbAutomation", { detail: data }),
    );
}

export function createPaleoBioDbAgent(): AppAgent {
    return {
        async executeAction(
            action: TypeAgentAction<PaleoBioDbActions>,
            context,
        ): Promise<undefined> {
            console.log(`Executing action: ${action.actionName}`);
            const actionName = action.actionName;
            switch (actionName) {
                case "setTaxonomicGroup": {
                    enablePaleoBioDbFilter("", action.parameters.taxa);
                    break;
                }

                case "setGeologicTimescale": {
                    enablePaleoBioDbFilter(action.parameters.geologicTime, "");
                    break;
                }

                case "clearFilters": {
                    clearPaleoBioDbFilter(
                        action.parameters.geologicTime,
                        action.parameters.taxa,
                        action.parameters.all,
                    );
                    break;
                }

                case "zoomIn": {
                    zoomInOnPaleoBioDb();
                    break;
                }

                case "zoomOut": {
                    zoomOutOnPaleoBioDb();
                    break;
                }

                case "panMap": {
                    panMapOnPaleoBioDb(action.parameters.direction);
                    break;
                }

                case "setMapLocation": {
                    let locationData: any = {};
                    locationData = await getLatLong(
                        action.parameters.locationName,
                    );
                    if (locationData !== undefined) {
                        setMapLocation(
                            locationData.latitude,
                            locationData.longitude,
                        );
                    }
                    break;
                }
            }
        },
    };
}

document.addEventListener("toPaleoDbAutomation", function (e: any) {
    var message = e.detail;
    console.log("received", message);
    const actionName = message.actionName;
    switch (actionName) {
        case "zoomIn": {
            zoomInOnPaleoBioDb();
            sendResponse({});
            break;
        }

        case "zoomOut": {
            zoomOutOnPaleoBioDb();
            sendResponse({});
            break;
        }
    }
});

async function readFileContent(fileName: string): Promise<string> {
    const fileUrl = await getExtensionFilePath(fileName);
    return fetch(fileUrl).then((response) => {
        if (!response.ok) {
            throw new Error(
                `Failed to load file: ${response.status} ${response.statusText}`,
            );
        }
        return response.text();
    });
}

let registered = false;
document.addEventListener("DOMContentLoaded", async () => {
    const schemaTs = await readFileContent("/sites/paleobiodbSchema.mts");
    const agent = createPaleoBioDbAgent();
    const manifest: AppAgentManifest = {
        emojiChar: "🦖",
        description:
            "This enables users to explore paleological data. Users can filter fossil data by location, by geological time and by taxon.",
        schema: {
            description:
                "This enables users to explore paleological data. Users can filter fossil data by location, by geological time and by taxon.",
            schemaType: "PaleoBioDbActions",
            schemaFile: { content: schemaTs, format: "ts" },
        },
    };

    if (!registered) {
        (window as any)
            .registerTypeAgent("paleoBioDb", manifest, agent)
            .then(() => {
                console.log("PaleoBioDB agent registered");
            })
            .catch((e: any) => {
                console.error("Failed to register PaleoBioDB agent", e);
            });
        registered = true;
    }
});
