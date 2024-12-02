// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

declare var Android: {    

    showToast: (message: string) => void;
    setAlarm: (time: string) => void;
    callPhoneNumber: (phoneNumber: string) => void;
    sendSMS: (phoneNumber: string, message: string) => void;
    searchNearby: (searchTerm: string) => void;
    automateUI: (prompt: string) => void;

    // Speech Reco
    isSpeechRecognitionSupported: () => boolean;
    recognize: (callback: (test: string | undefined) => void) => void;
};

declare var Bridge: {
    interfaces: {
        Android: {
            recognize: (callback: (test: string | undefined) => void) => void;
            domReady: (callback: (userMessage: string) => void | undefined) => void;
        }
    }
}