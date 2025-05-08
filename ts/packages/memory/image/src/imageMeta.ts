// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    dataFrame,
    IKnowledgeSource,
    IMessage,
    IMessageMetadata,
} from "knowpro";
import { conversation as kpLib, image } from "knowledge-processor";
import path from "node:path";
import { AddressOutput } from "@azure-rest/maps-search";
//import registerDebug from "debug";

//const debug = registerDebug("typeagent:image-memory");

export class Image implements IMessage {
    public timestamp: string | undefined;
    constructor(
        public textChunks: string[],
        public metadata: ImageMeta,
        public tags: string[] = [],
    ) {
        this.timestamp = metadata.img.dateTaken;
    }
    getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }
}

// metadata for images
export class ImageMeta implements IKnowledgeSource, IMessageMetadata {
    public imageEntity: kpLib.ConcreteEntity | undefined = undefined;
    public dataFrameValues: Record<string, dataFrame.DataFrameValue> = {};

    constructor(
        public fileName: string,
        public img: image.Image,
    ) {}

    public get source() {
        return undefined;
    }
    public get dest() {
        return undefined;
    }

    getKnowledge() {
        this.imageEntity = {
            name: `${path.basename(this.img.fileName)} - ${this.img.title}`,
            type: ["file", "image"],
            facets: [
                { name: "File Name", value: this.img.fileName },
                //{ name: "Title", value: this.image.title },
                //{ name: "Caption", value: this.image.title },
            ],
        };

        // EXIF data are facets of this image
        for (let i = 0; i < this.img?.exifData.length; i++) {
            const exifPropertyName = this.img?.exifData[i][0];
            const exifPropertyValue = this.img?.exifData[i][1];

            if (exifPropertyName && exifPropertyValue) {
                this.imageEntity.facets!.push({
                    name: exifPropertyName,
                    value: exifPropertyValue,
                });

                // save the EXIF tag as a dataFrame record
                this.dataFrameValues[exifPropertyName] = exifPropertyValue;
            }
        }

        // create the return values
        let entities: kpLib.ConcreteEntity[] = [];
        let actions: kpLib.Action[] = [];
        let inverseActions: kpLib.Action[] = [];
        let topics: kpLib.Topic[] = [];
        const timestampParam = [];

        if (this.img.dateTaken) {
            timestampParam.push({
                name: "Timestamp",
                value: this.img.dateTaken,
            });
        }

        // add the image entity
        entities.push(this.imageEntity);

        // if we have POI those are also entities
        if (this.img.nearbyPOI) {
            for (let i = 0; i < this.img.nearbyPOI.length; i++) {
                const poiEntity: kpLib.ConcreteEntity = {
                    name: this.img.nearbyPOI[i].name!,
                    type: [
                        ...this.img.nearbyPOI[i].categories!,
                        "PointOfInterest",
                    ],
                    facets: [],
                };

                if (this.img.nearbyPOI[i].freeFormAddress) {
                    poiEntity.facets?.push({
                        name: "address",
                        value: this.img.nearbyPOI[i].freeFormAddress!,
                    });
                }

                if (
                    this.img.nearbyPOI[i].position != undefined &&
                    this.img.nearbyPOI[i].position?.latitude != undefined &&
                    this.img.nearbyPOI[i].position?.longitude != undefined
                ) {
                    poiEntity.facets?.push({
                        name: "position",
                        value: JSON.stringify(this.img.nearbyPOI[i].position),
                    });
                    poiEntity.facets?.push({
                        name: "longitude",
                        value: this.img.nearbyPOI[
                            i
                        ].position!.longitude!.toString(),
                    });
                    poiEntity.facets?.push({
                        name: "latitude",
                        value: this.img.nearbyPOI[
                            i
                        ].position!.latitude!.toString(),
                    });
                }

                if (
                    this.img.nearbyPOI[i].categories !== undefined &&
                    this.img.nearbyPOI[i].categories!.length > 0
                ) {
                    poiEntity.facets?.push({
                        name: "category",
                        value: this.img.nearbyPOI[i].categories!.join(","),
                    });
                }

                entities.push(poiEntity);

                actions.push({
                    verbs: ["near"],
                    verbTense: "present",
                    subjectEntityName: this.img.fileName,
                    objectEntityName: this.img.nearbyPOI[i].name!,
                    indirectObjectEntityName: "ME", // TODO: image taker name
                });
            }
        }

        // reverse lookup addresses are also entities
        if (this.img.reverseGeocode) {
            for (let i = 0; i < this.img.reverseGeocode.length; i++) {
                // only put in high confidence items or the first one
                if (
                    (i == 0 ||
                        this.img.reverseGeocode[i].confidence == "High") &&
                    this.img.reverseGeocode[i].address !== undefined
                ) {
                    const addrOutput: AddressOutput =
                        this.img.reverseGeocode[i].address!;
                    const addrEntity: kpLib.ConcreteEntity = {
                        name:
                            this.img.reverseGeocode[i].address!
                                .formattedAddress ?? "",
                        type: ["address"],
                        facets: [],
                    };

                    // Add the address of the image as a facet to it's entity
                    if (i == 0 && addrOutput.formattedAddress) {
                        this.imageEntity.facets?.push({
                            name: "address",
                            value: addrOutput.formattedAddress,
                        });
                    }

                    // make the address an entity
                    entities.push(addrEntity);

                    // now make an entity for all of the different parts of the address
                    // and add them as facets to the address
                    if (addrOutput.addressLine) {
                        addrEntity.facets?.push({
                            name: "addressLine",
                            value: addrOutput.addressLine,
                        });
                        entities.push({
                            name: addrOutput.locality ?? "",
                            type: ["locality", "place"],
                        });
                    }
                    if (addrOutput.locality) {
                        addrEntity.facets?.push({
                            name: "locality",
                            value: addrOutput.locality,
                        });
                    }
                    if (addrOutput.neighborhood) {
                        addrEntity.facets?.push({
                            name: "neighborhood",
                            value: addrOutput.neighborhood,
                        });
                        entities.push({
                            name: addrOutput.neighborhood ?? "",
                            type: ["neighborhood", "place"],
                        });
                    }
                    if (addrOutput.adminDistricts) {
                        addrEntity.facets?.push({
                            name: "district",
                            value: JSON.stringify(addrOutput.adminDistricts),
                        });
                        for (
                            let i = 0;
                            i < addrOutput.adminDistricts.length;
                            i++
                        ) {
                            const e: kpLib.ConcreteEntity = {
                                name: addrOutput.adminDistricts[i].name ?? "",
                                type: ["district", "place"],
                                facets: [],
                            };

                            if (addrOutput.adminDistricts[i].shortName) {
                                e.facets?.push({
                                    name: "shortName",
                                    value: addrOutput.adminDistricts[i]
                                        .shortName!,
                                });
                            }

                            entities.push(e);
                        }
                    }
                    if (addrOutput.postalCode) {
                        addrEntity.facets?.push({
                            name: "postalCode",
                            value: addrOutput.postalCode,
                        });
                        entities.push({
                            name: addrOutput.postalCode ?? "",
                            type: ["postalCode", "place"],
                        });
                    }
                    if (addrOutput.countryRegion) {
                        if (
                            addrOutput.countryRegion.name !== undefined &&
                            addrOutput.countryRegion.name.length > 0
                        ) {
                            addrEntity.facets?.push({
                                name: "countryName",
                                value: addrOutput.countryRegion?.name!,
                            });
                        }
                        if (
                            addrOutput.countryRegion.ISO !== undefined &&
                            addrOutput.countryRegion.ISO.length > 0
                        ) {
                            addrEntity.facets?.push({
                                name: "countryISO",
                                value: addrOutput.countryRegion?.ISO!,
                            });
                        }
                        entities.push({
                            name: addrOutput.countryRegion.name ?? "",
                            type: ["country", "place"],
                            //facets: [ { name: "ISO", value: addrOutput.countryRegion.ISO ?? "" } ]
                        });
                    }
                    if (addrOutput.intersection) {
                        addrEntity.facets?.push({
                            name: "intersection",
                            value: JSON.stringify(addrOutput.intersection),
                        });
                        entities.push({
                            name: addrOutput.intersection.displayName ?? "",
                            type: ["intersection", "place"],
                        });
                    }

                    actions.push({
                        verbs: ["captured at"],
                        verbTense: "present",
                        subjectEntityName: this.imageEntity.name,
                        objectEntityName: addrEntity.name,
                        params: timestampParam,
                        indirectObjectEntityName: "none",
                    });
                }
            }
        }

        // add knowledge response items from ImageMeta to knowledge
        if (this.img.knowledge?.entities) {
            entities = entities.concat(this.img.knowledge?.entities);

            // each extracted entity "is in" the image
            // and all such entities are "contained by" the image
            for (let i = 0; i < this.img.knowledge?.entities.length; i++) {
                actions.push({
                    verbs: ["within"],
                    verbTense: "present",
                    subjectEntityName: this.img.knowledge?.entities[i].name,
                    objectEntityName: this.imageEntity.name,
                    indirectObjectEntityName: "none",
                    params: timestampParam,
                    subjectEntityFacet: undefined,
                });

                actions.push({
                    verbs: ["contains"],
                    verbTense: "present",
                    subjectEntityName: this.imageEntity.name,
                    objectEntityName: this.img.knowledge.entities[i].name,
                    indirectObjectEntityName: "none",
                    params: timestampParam,
                    subjectEntityFacet: undefined,
                });
            }
        }
        if (this.img.knowledge?.actions) {
            actions = actions.concat(this.img.knowledge?.actions);
        }
        if (this.img.knowledge?.inverseActions) {
            inverseActions = actions.concat(this.img.knowledge?.inverseActions);
        }
        if (this.img.knowledge?.topics) {
            topics = topics.concat(this.img.knowledge.topics);
        }

        return {
            entities,
            actions,
            inverseActions: inverseActions,
            topics: topics,
        };
    }

    getGeo(): dataFrame.DataFrameRecord | undefined {
        // no EXIF data, no geo
        if (
            !this.dataFrameValues["GPSLatitude"] ||
            //&& this.dataFrameValues["GPSLatitudeRef"]
            //&& this.dataFrameValues["GPSLongitudeRef"]
            !this.dataFrameValues["GPSLongitude"]
        ) {
            return undefined;
        }

        // TODO: Ensure localization
        const latlong: dataFrame.DataFrameRecord = {};
        //        if (!this.dataFrameValues["latlong"]) {
        const latRef: dataFrame.DataFrameValue =
            this.dataFrameValues["GPSLatitudeRef"];
        const longRef: dataFrame.DataFrameValue =
            this.dataFrameValues["GPSLongitudeRef"];
        const lat: dataFrame.DataFrameValue =
            this.dataFrameValues["GPSLatitude"];
        const long: dataFrame.DataFrameValue =
            this.dataFrameValues["GPSLongitude"];

        //const latlong: dataFrame.DataFrameValue = { ...lat, ...long };
        //const latlong2: dataFrame.DataFrameValue = { lat: lat["lat"], long: long["long"] };
        if (latRef?.toString().startsWith("South")) {
            latlong.latitude = parseFloat(`-${lat}`);
        } else {
            latlong.latitude = lat;
        }

        if (longRef?.toString().startsWith("West")) {
            latlong.longitude = parseFloat(`-${long}`);
        } else {
            latlong.longitude = long;
        }

        //            this.dataFrameValues["latlong"] = latlong2;
        //        }

        return latlong;
    }
}
