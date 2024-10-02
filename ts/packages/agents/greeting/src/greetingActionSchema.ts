// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type GreetingAction = PersonalizedGreetingAction | UnknownAction;

// Use this action greet the user.
// Generate a five possible greetings and make sure they are varied in tone, length, cadence, delivery, and style.
// Make sure they don't sound similar and are appropriate for the time and day (i.e. Happy Friday, good evening, etc.).
// Some examples should borrow common greetings from languages other than English.
// Come up with a spontaneous greeting that conveys one of the following moods: friendly, enthusiastic, excited, polite, cheerful, happy, positive, welcoming, affectionate, warm, jovial, lively, energetic, radiant, or breezy.
// The goal is to create a warm and inviting atmosphere for the person you're greeting, so feel free to be creative and use your own style
export interface PersonalizedGreetingAction {
    actionName: "personalizedGreetingResponse";
    parameters: {
        // the original request/greeting from the user
        originalRequest: string;
        // a set possible generic greeting responses to the user
        possibleGreetings: GenericGreeting[];
    };
}

// A typical greeting
// Greetings can include some color commentary and or an initiator like "Wow, you're up late" or "I'm glad it's Friday"
export interface GenericGreeting {
    // The greeting response to the user such as "Top of the morning to ya!" or "Hey, how's it going?" or "What a nice day we're having, what's up!?" or "What are we going to do today?"
    // Be sure to make the greeting relevant to time of day (i.e. don't say good morning in the afternoon).
    // you can also use greetings such as Namaste/Shalom/Bonjour or smilar.
    generatedGreeting: string;
}

// if the user types text that can not easily be understood as a list action, this action is used
export interface UnknownAction {
    actionName: "unknown";
    parameters: {
        // text typed by the user that the system did not understand
        text: string;
    };
}
