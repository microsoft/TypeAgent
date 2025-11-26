// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { XmpTag } from "exifreader";
import { exifGPSTagToLatLong, LatLong } from "../src/location.js";

describe("Location Tests", () => {
    it("EXIF LatLong to LatLong", () => {
        const lat: XmpTag = {
            value: "47.6204",
            description: "47.6204",
            attributes: {},
        };
        const long: XmpTag = {
            value: "122.3491",
            description: "122.3491",
            attributes: {},
        };
        const latRef: XmpTag = {
            value: "N",
            description: "North Latitude",
            attributes: {},
        };
        const longRef: XmpTag = {
            value: "W",
            description: "West Longitude",
            attributes: {},
        };

        const ll: LatLong = exifGPSTagToLatLong(lat, latRef, long, longRef)!;
        expect(ll.latitude == "47.6204");
        expect(ll.longitude == "-122.3491");

        const llu: LatLong | undefined = exifGPSTagToLatLong(
            lat,
            latRef,
            undefined,
            longRef,
        );
        expect(llu === undefined);
    });
});
