// The following types define the structure of an object of type EchoAction that represents the requested request from the user.
export type EchoAction = GenEchoAction;

// If the user asks to echo a message back, the system will return a GenEchoAction. The text parameter is the message to be echoed back.
// will contain the text to be echoed back to the user.
export type GenEchoAction = {
    actionName: "echoGen";
    parameters: {
        text?: string;
        // Generate an alternate response based on the request
        altResponse?: string;
    };
};
