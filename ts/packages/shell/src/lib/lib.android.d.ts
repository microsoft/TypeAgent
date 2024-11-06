// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare var Android: {
    showToast: (message: string) => void;
    setAlarm: (time: string) => void;
    callPhoneNumber: (phoneNumber: string) => void;
    sendSMS: (phoneNumber: string, message: string) => void;
    searchNearby: (searchTerm: string) => void;
};