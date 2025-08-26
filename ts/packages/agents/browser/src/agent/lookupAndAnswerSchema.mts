// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserLookupActions = LookupAndAnswerInternet;

// The user request is a question about general knowledge that can be found from the internet.
// (e.g. "what is the current price of Microsoft stock?")
// look up for contemporary internet information including sports scores, news events, or current commerce offerings, use the lookups parameter to request a lookup of the information on the user's behalf; the assistant will generate a response based on the lookup results
// Lookup *facts* you don't know or if your facts are out of date.
// E.g. stock prices, time sensitive data, etc
// the search strings to look up on the user's behalf should be specific enough to return the correct information
// it is recommended to include the same entities as in the user request
export type LookupAndAnswerInternet = {
    actionName: "lookupAndAnswerInternet";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the internet search terms to use
        internetLookups: string[];
        // specific sites to look up in.
        sites?: string[];
    };
};
