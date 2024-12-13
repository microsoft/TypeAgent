// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseTranscriptDuration } from "../src/conversation/transcript.js";

describe("Transcripts", () => {
    test("duration", () => {
        const dt = parseTranscriptDuration("February 2022", 60);

        const startDate = dt.startDate;
        expect(startDate.date.day).toEqual(1);
        expect(startDate.date.month).toEqual(2);
        expect(startDate.date.year).toEqual(2022);
        expect(startDate.time).toBeDefined();
        expect(startDate.time!.hour).toEqual(0);

        const stopDate = dt.stopDate;
        expect(stopDate).toBeDefined();
        expect(stopDate!.date.day).toEqual(1);
        expect(stopDate!.date.month).toEqual(2);
        expect(stopDate!.date.year).toEqual(2022);
        expect(stopDate!.time!.hour).toEqual(1);
    });
});
