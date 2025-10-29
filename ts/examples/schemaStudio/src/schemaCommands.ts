import {
    CommandHandler,
    CommandMetadata,
    CommandResult,
    InteractiveIo,
    parseNamedArguments,
} from "interactive-app";
import { SchemaStudio } from "./studio.js";
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "fs";
import { createTypeChat, loadSchema } from "typeagent";
import { ChatModelWithStreaming, CompletionSettings, openai } from "aiclient";
import { CreateSchemaAction } from "./settingsSchemaSchema.js";
import { PromptSection, Result } from "typechat";

export function createSettingsSchemaCommand(
    studio: SchemaStudio,
): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Generates schemas for settings commands",
        options: {
            file: {
                description:
                    "The input TSV file that contains the commands to schematize",
                type: "string",
                defaultValue:
                    "examples/schemaStudio/data/sampleSettingsCommands.txt",
            },
            output: {
                description:
                    "The output schema file to write the generated schemas to",
                type: "string",
                defaultValue:
                    "examples/schemaStudio/output/settingsCommandSchemasV2.ts",
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const runStarted = Date.now();

        // load the CSV, remove blank lines
        const settingsActions = readFileSync(namedArgs.file, "utf-8")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        // remove column headings
        settingsActions.shift();

        // delete the output file if it exists
        if (existsSync(namedArgs.output)) {
            unlinkSync(namedArgs.output);
        }

        let union = "export type SettingsAction =\n";
        for (const actionLine of settingsActions) {
            const [actionName, testUtterance, description, id] =
                actionLine.split("\t");

            io.writer.writeLine(
                `Generating schema for action: ${actionName}, description: ${description}, id: ${id}.`,
            );
            io.writer.writeLine(`\ttestUtterance: '${testUtterance}'`);

            const response = await getTypeChatResponse(
                actionName,
                testUtterance,
                description,
                id,
            );
            if (response.success) {
                appendFileSync(
                    namedArgs.output,
                    `\n${response.data.parameters.schema}\n`,
                );
                union += `    | ${actionName}\n`;
            } else {
                io.writer.writeLine(
                    `Error generating schema for action ${actionName}: ${response.message}`,
                );
            }
        }

        appendFileSync(namedArgs.output, `\n${union};\n`);

        io.writer.writeLine(
            "TODO: Generating settings command schemas..." +
                JSON.stringify(namedArgs),
        );

        return `Settings schema generation completed in ${Date.now() - runStarted} ms`;
    };

    handler.metadata = argDef;
    return handler;
}

const instructions: string = `
You generate TypeScript schemas for actions that are defined from XML fragments. 
Each fragment defines an action that define user intent.  


For example for a "play track action":

\`\`\`TypeScript
// Play a specific track
export interface PlayTrackAction {
    actionName: "playTrack";
    id: "play_track";
    parameters: {        
        originalUserRequest: string;
        trackName: string;
        albumName?: string;
        artists?: string[];
    };
}
\`\`\`

The source XML data for PlayTrackAction is:

\`\`\`xml
<action id="play_track" name="PlayTrackAction">
    <desc>Play a specific track</desc>
    <sample>play purple rain by prince</sample>
</action>
\`\`\`

- Given the given action id, description, sample user expression, and name; generate the schema. 
- DO NOT MODIFY the ID, use it as is otherwise you'll break something.
- Only use the sample user expression to help determine what parameters are needed. Do NOT include the sample in the schema.
- Annotate each interface with the description as a prefix comment. USE SINGLE line comments (i.e. //) ONLY.
`;

async function getTypeChatResponse(
    actionName: string,
    testUtterance: string,
    description: string,
    id: string,
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
            <action id="${id}" name="${actionName}">
                <desc>${description.replaceAll('"', "'")}</desc>
                <sample>${testUtterance}</sample>
            </action>
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
