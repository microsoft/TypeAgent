// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type EmailAction =
    | SendEmailAction
    | ReplyEmailAction
    | ForwardEmailAction
    | FindEmailAction;

// Type for generating the body content of an email based on the user input
export interface GenerateContent {
    // Flag to indicate if body content needs to be generated using a web search based on the user request.
    // If the user request can be answered using a web search, set this flag to true and provide the search query.
    // For Ex: If the user input is "Send email to Megan with notes about the RLHF on instruction tuning of LLMs",
    // the flag should be true and the body should be generated using a web search for "RLHF on instruction tuning of LLMs"
    // Ex: If the user input is something to the effect "sending email to Bob with the recipe for a vanilla cake",
    // the flag should be true and the body should be generated using a web search for "recipe for a vanilla cake"
    // If the user input is " Send email to Megan asking if she want to meet coffee", the flag should be false
    generateBody?: boolean;
    // search query to generate the body content (optional)
    bodySearchQuery?: string;
}

// Type for sending a simple email
export type SendEmailAction = {
    actionName: "sendEmail";
    parameters: {
        // Subject of the email, infer the subject based on the user input
        subject: string;
        // Body content of the email, can be plain text or HTML, generate the body
        // based on the user input
        body?: string;
        // Recipients, infer the recipients based on the user input but don't change strings
        // so if the user types "send email to Jen" don't change it to an email address,
        // just infer that "Jen" is one of the recipients
        to: string[];
        // Carbon copy recipients (optional), infere CC recipients based on the user input
        cc?: string[];
        // Blind carbon copy recipients (optional), infer the BCC recipients based on the user input
        bcc?: string[];
        // File paths or URLs of attachments (optional)
        attachments?: string[]; // File paths or URLs of attachments (optional)
        // Information needed to generate the body content based on the user input
        genContent: GenerateContent;
    };
};

interface MsgDateTimeRange {
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    startTime?: string;
    // use the format hh:mm pm (example: 2:30 pm), for noon emit 12:00 pm, for midnight emit 12:00 am
    endTime?: string;
    // date (example: March 22, 2024) or relative date (example: after EventReference)
    // if the user has not specified a year please just use the month and day
    day?: string;
    // (examples: this month, this week, in the next two days)
    dayRange?: string;
}

interface MessageReference {
    // Email address of the sender, infer the sender based on the user input
    // like look for message fror by Jen and Ben should add Jen and Ben as senders
    senders?: string[];
    // Subject of the email. If the user asks to find an email with a specific subject
    // The subject might not be an exact match, so use the subject to filter the results
    subject?: string;
    // Content of the email, infer the content based on the user input. The user can refere an email
    // by mentioning a word or phrase in the email content.
    content?: string;
    // Date and time the email was sent, infer the date and time based on the user input
    receivedDateTime?: MsgDateTimeRange;
    srcFolder?: string; // Folder where the email is located (optional)
    destfolder?: string; // Folder where the email is to be moved to (optional)
}

// Type for forwarding an email
export type ForwardEmailAction = {
    actionName: "forwardEmail";
    parameters: {
        // Recipients
        to: string[];
        // Carbon copy recipients (optional)
        cc?: string[];
        // Blind carbon copy recipients (optional)
        bcc?: string[];
        // Additional message (optional), can be plain text or HTML and
        // inferred from the user request
        additionalMessage?: string;
        // Reference to the email message to forward
        messageRef: MessageReference;
    };
};

// Type for replying to an email
export type ReplyEmailAction = {
    actionName: "replyEmail";
    parameters: {
        // Body content of the reply email (optional), can be plain text or HTML, generate the body
        // based on the user input
        body?: string;
        // Carbon copy recipients (optional)
        cc?: string[];
        // Blind carbon copy recipients (optional)
        bcc?: string[];
        // File paths or URLs of attachments (optional)
        attachments?: string[];
        // Reference to the email message to reply to
        messageRef: MessageReference;
    };
};

// Type for finding an email message (search for emails)
export type FindEmailAction = {
    actionName: "findEmail";
    parameters: {
        // Reference to the email message to find
        messageRef: MessageReference;
    };
};
