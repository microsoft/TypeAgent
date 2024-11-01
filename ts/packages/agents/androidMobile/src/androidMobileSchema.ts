// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AndroidMobileAction = CallPhoneNumberAction | SetAlarmAction | UnknownAction;

// calls a user's phone number but only if we know the phone number
export type CallPhoneNumberAction = {
    actionName: "callPhoneNumber",
    parameters: {
        // the original request of the user
        originalRequest: string;
        // the phone number to dial
        phoneNumber: string;
    }
}

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

// if the user types text that can not easily be understood as a list action, this action is used
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}
