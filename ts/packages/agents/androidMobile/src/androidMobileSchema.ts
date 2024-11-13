// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AndroidMobileAction =
    | SendSMSAction
    | CallPhoneNumberAction
    | SetAlarmAction
    | SearchNearbyAction
    | AutomatePhoneUIAction;

// sends a SMS to the supplied phone number
export type SendSMSAction = {
    actionName: "sendSMS";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the phone number to message
        phoneNumber: string;
        // the sms message
        message: string;
    };
};

// calls a user's phone number but only if we know the phone number
export type CallPhoneNumberAction = {
    actionName: "callPhoneNumber";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the phone number to dial
        phoneNumber: string;
    };
};

// sets an alarm on the local mobile device
export type SetAlarmAction = {
    actionName: "setAlarm";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the time for the alarm in the format YYYY-mm-ddThh:mm:ss (i.e. 2024-02-15T08:30:15 )
        time: string;
    };
};

// opens the maps application and performs a location search
export type SearchNearbyAction = {
    actionName: "searchNearby";
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the search term to use when searching nearby locations
        searchTerm: string;
    };
};

// Automation agent on the phone that can perform UI tasks on behalf of the user
export type AutomatePhoneUIAction = {
    actionName: "automateUI";
    parameters: {
        // the original request of the user
        originalRequest: string;
    };
};
