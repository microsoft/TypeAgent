// TODO: Copyright

// Use an LLM to translate a command in English to a command structure.
// The command structure is given by some schema.

import { CommandHandler, CommandMetadata, InteractiveIo } from "interactive-app";
import { TypeChatLanguageModel } from "typechat";

console.log("[codeProcessor.js loading]");

export interface CommandTransformer {
    transform(command: string, io: InteractiveIo): Promise<string | undefined>;
    model: TypeChatLanguageModel;
    metadata: Record<string, CommandMetadata>;
}

export function createCommandTransformer(model: TypeChatLanguageModel): CommandTransformer {
    const meta: Record<string, CommandMetadata> = {};
    const transformer: CommandTransformer = {
        transform,
        model,
        metadata,
    }

    async function transform(command: string): Promise<string | undefined> {
        return undefined;
    }

    return transformer;
}

export function copyMetadataToCommandTransformer(handlers: Record<string, CommandHandler>, commandTransformer: CommandTransformer): void {
    for (const key in handlers) {
        const metadata = handlers[key].metadata;
        if (typeof metadata === "object") {
            commandTransformer.metadata[key] = metadata;
        }
    }
}

/* Schema draft

🤖> @help clearCodeIndex
Clear the code index

🤖> @help codeAnswer
Answer questions about code

USAGE
codeAnswer [OPTIONS]

OPTIONS
  question    Question to ask
  sourceFile  Path to source file
              (default): ../../src/codeChat/testCode/testCode.ts
  verbose     (default): false
🤖> @help codeBreakpoints
Suggest where to set breakpoints in a Typescript file

USAGE
codeBreakpoints [OPTIONS]

OPTIONS
  bug         A description of the observed bug
              (default): I am observing assertion failures in the code below.
  moduleDir   Path to modules dir
  sourceFile  Path to source file
              (default): ../../src/codeChat/testCode/snippet.ts
  verbose     Verbose output
              (default): false
🤖> @help codeReview
Review the given Typescript file

USAGE
codeReview [OPTIONS]

OPTIONS
  sourceFile  Path to source file
              (default): ../../src/codeChat/testCode/testCode.ts
  verbose     Verbose output
              (default): false
🤖> @help codeDebug
Debug the given Typescript file

USAGE
codeDebug [OPTIONS]

OPTIONS
  bug         A description of the observed bug
              (default): I am observing assertion failures in the code below. Review the code below and explain why
  moduleDir   Path to modules dir
  sourceFile  Path to source file
              (default): ../../src/codeChat/testCode/snippet.ts
  verbose     Verbose output
              (default): false
🤖> @help codeDocument
Document given code

USAGE
codeDocument [OPTIONS]

OPTIONS
  sourceFile  Path to source file
              (default): ../../src/codeChat/testCode/testCode.ts
🤖> @help indexCode
Index given code

USAGE
indexCode --sourceFile <path> [OPTIONS]

ARGUMENTS
  sourceFile  Path to source file

OPTIONS
  module   Module name
  verbose  (default): false
🤖> @help clearCodeIndex
Clear the code index

🤖> @help regex
Generate a regular expression from the given requirements.


 */
