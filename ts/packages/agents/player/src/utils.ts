// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import axios from "axios";

export const translateAxiosError = (e: any, url?: string) => {
    throw new Error(translateAxiosErrorNoThrow(e, url));
};

export const translateAxiosErrorNoThrow = (e: any, url?: string) => {
    if (e instanceof axios.AxiosError) {
        const responseData = e.response?.data;
        const dataString: string =
            typeof responseData === "object"
                ? JSON.stringify(responseData)
                : responseData;

        return `${e.message}: ${url ? `${url} ` : ""}${dataString}`;
    } else {
        return e;
    }
};
