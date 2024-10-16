// TODO: Copyright

// Schema for CommandMetadata from interactiveApp.ts

export type ArgType = "string" | "number" | "integer" | "boolean" | "path";

export interface ArgDef {
    type?: ArgType | undefined;
    description?: string | undefined;
    defaultValue?: any | undefined;
}

export type CommandMetadata = {
    description?: string;
    args?: Record<string, ArgDef>;
    options?: Record<string, ArgDef>;
};

export type codeReview = {
    "description": "Review the given Typescript file",
    "options": {
      "sourceFile": {
        "description": "Path to source file",
        "type": "path",
        "defaultValue": "../../src/codeChat/testCode/testCode.ts"
      },
      "verbose": {
        "description": "Verbose output",
        "type": "boolean",
        "defaultValue": false
      }
    }
  }
  
  export type codeDebug = {
    "description": "Debug the given Typescript file",
    "options": {
      "sourceFile": {
        "description": "Path to source file",
        "type": "path",
        "defaultValue": "../../src/codeChat/testCode/snippet.ts"
      },
      "moduleDir": {
        "description": "Path to modules dir",
        "type": "path"
      },
      "bug": {
        "description": "A description of the observed bug",
        "defaultValue": "I am observing assertion failures in the code below. Review the code below and explain why"
      },
      "verbose": {
        "description": "Verbose output",
        "type": "boolean",
        "defaultValue": false
      }
    }
  }
  
  export type codeBreakpoints = {
    "description": "Suggest where to set breakpoints in a Typescript file",
    "options": {
      "sourceFile": {
        "description": "Path to source file",
        "type": "path",
        "defaultValue": "../../src/codeChat/testCode/snippet.ts"
      },
      "moduleDir": {
        "description": "Path to modules dir",
        "type": "path"
      },
      "bug": {
        "description": "A description of the observed bug",
        "defaultValue": "I am observing assertion failures in the code below."
      },
      "verbose": {
        "description": "Verbose output",
        "type": "boolean",
        "defaultValue": false
      }
    }
  }
  
  export type codeAnswer = {
    "description": "Answer questions about code",
    "options": {
      "question": {
        "description": "Question to ask"
      },
      "sourceFile": {
        "description": "Path to source file",
        "type": "path",
        "defaultValue": "../../src/codeChat/testCode/testCode.ts"
      },
      "verbose": {
        "type": "boolean",
        "defaultValue": false
      }
    }
  }
  
  export type codeDocument = {
    "description": "Document given code",
    "options": {
      "sourceFile": {
        "description": "Path to source file",
        "type": "path",
        "defaultValue": "../../src/codeChat/testCode/testCode.ts"
      }
    }
  }
  
  export type indexCode = {
    "description": "Index given code",
    "args": {
      "sourceFile": {
        "description": "Path to source file",
        "type": "path"
      }
    },
    "options": {
      "module": {
        "description": "Module name"
      },
      "verbose": {
        "type": "boolean",
        "defaultValue": false
      }
    }
  }
  
  export type findCode = {
    "description": "Query the code index",
    "args": {
      "query": {
        "description": "Query to run"
      }
    },
    "options": {
      "maxMatches": {
        "description": "Max number of matches",
        "type": "number",
        "defaultValue": 1
      }
    }
  }
  