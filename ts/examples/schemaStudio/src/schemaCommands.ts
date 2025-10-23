import { CommandHandler, CommandMetadata, CommandResult, InteractiveIo, parseNamedArguments } from "interactive-app";
import { SchemaStudio } from "./studio.js";
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import { createTypeChat, loadSchema } from "typeagent";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { CreateSchemaAction } from "./settingsSchemaSchema.js";
import { PromptSection, Result } from "typechat";

export function createSettingsSchemaCommands(studio: SchemaStudio): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Generates schemas for settings commands",
        options: {
            file: {
                description: "The input CSV file that contains the commands to schematize",
                type: "string",
                defaultValue: "examples/schemaStudio/data/settingsCommands.csv"
            },
            output: {
                description: "The output schema file to write the generated schemas to",
                type: "string",
                defaultValue: "examples/schemaStudio/output/settingsCommandSchemas.ts"
            }
        }
    }

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const runStarted = Date.now();

        // load the CSV, remove blank lines
        const settingsActions = readFileSync(namedArgs.file, "utf-8").split("\n").map(line => line.trim()).filter(line => line.length > 0);

        // remove column headings
        settingsActions.shift();

        // delete the output file if it exists
        if (existsSync(namedArgs.output)) {
            unlinkSync(namedArgs.output);
        }

        for (const actionLine of settingsActions) {
            const [actionName, testUtterance, description] = actionLine.split(",");

            io.writer.writeLine(`Generating schema for action: ${actionName}, description: ${description}`);
            io.writer.writeLine(`\ttestUtterance: '${testUtterance}'`);

            const response = await getTypeChatResponse(actionName, testUtterance, description);
            if (response.success) {
                appendFileSync(namedArgs.output, `\n${response.data.parameters.schema}\n`);
            } else {
                io.writer.writeLine(`Error generating schema for action ${actionName}: ${response.message}`);
            }
        };


        // TODO: call LLM and generate schemas
        io.writer.writeLine("TODO: Generating settings command schemas..." + JSON.stringify(namedArgs));
        // TODO: flush schemas to output schema file

        return `Settings schema generation completed in ${Date.now() - runStarted} ms`;  
    }

    handler.metadata = argDef;
    return handler;
}

const instructions: string = `
You generate TypeScript schemas that define user intent into typed objects.  
For example for a "music player agent" there is an action to play a track.  
The schema for that action looks like:

\`\`\`
// Play a specific track
export interface PlayTrackAction {
    actionName: "playTrack";
    parameters: {
        originalUserRequest: string;
        trackName: string;
        albumName?: string;
        artists?: string[];
    };
}
\`\`\`

Given the given action description, sample user expression, and action name; generate the schema.
`;


 async function getTypeChatResponse(
    actionName: string,
    testUtterance: string,
    description: string,
    ): Promise<Result<CreateSchemaAction>> {
        // Create Model instance
        let chatModel = createModel();

        // Create Chat History
        let maxContextLength = 8196;
        let maxWindowLength = 30;
        let chatHistory: PromptSection[] = [];

        // create TypeChat object
        const chat = createTypeChat<CreateSchemaAction>(
            chatModel,
            loadSchema(["settingsSchemaSchema.ts"], import.meta.url),
            "CreateSchemaAction",
            instructions,
            chatHistory,
            maxContextLength,
            maxWindowLength,
        );

        // make the request
        const chatResponse = await chat.translate(`
            actionName: ${actionName}
            description: ${description}
            testUtterance: ${testUtterance}
            `);

        return chatResponse;
    }

    function createModel(): ChatModelWithStreaming {
        let apiSettings: openai.ApiSettings | undefined;
        if (!apiSettings) {
            // Create default model
            apiSettings = openai.apiSettingsFromEnv();
        }
        let completionSettings: CompletionSettings = {
            temperature: 1.0,
            // Max response tokens
            max_tokens: 1000,
            // createChatModel will remove it if the model doesn't support it
            response_format: { type: "json_object" },
        };
        const chatModel = openai.createChatModel(
            apiSettings,
            completionSettings,
            undefined,
            ["createSchemaAction"],
        );

        return chatModel;
    }
