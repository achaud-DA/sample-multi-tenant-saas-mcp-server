"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInferenceHandler = createInferenceHandler;
const amazon_bedrock_1 = require("@ai-sdk/amazon-bedrock");
const ai_1 = require("ai");
async function createInferenceHandler(params) {
    const { model, messages, system_message, max_tokens, tools, resources, prompts } = params;
    // Convert MCP tools to AI SDK format
    const mcpTools = Object.fromEntries(tools.map((t) => {
        return [
            t.name,
            {
                description: t.description,
                parameters: t.inputSchema ? (0, ai_1.jsonSchema)(t.inputSchema) : { type: "object" },
            },
        ];
    }));
    // Add readResource tool if resources are available
    if (resources.length > 0) {
        mcpTools.readResource = {
            description: `Read content from available MCP resources. Available resources: ${resources.map(r => `${r.name} (${r.uri})`).join(', ')}`,
            parameters: (0, ai_1.jsonSchema)({
                type: "object",
                properties: {
                    uri: {
                        type: "string",
                        description: "URI of the resource to read"
                    }
                },
                required: ["uri"]
            }),
        };
    }
    // Add getPrompt tool if prompts are available
    if (prompts.length > 0) {
        mcpTools.getPrompt = {
            description: `Get and execute MCP prompts. Available prompts: ${prompts.map(p => `${p.name} - ${p.description}`).join(', ')}`,
            parameters: (0, ai_1.jsonSchema)({
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name of the prompt to get"
                    },
                    arguments: {
                        type: "object",
                        description: "Arguments for the prompt"
                    }
                },
                required: ["name"]
            }),
        };
    }
    // Create the streamText result
    return (0, ai_1.streamText)({
        model: (0, amazon_bedrock_1.bedrock)(model),
        messages,
        system: system_message,
        maxTokens: max_tokens,
        tools: mcpTools,
        toolCallStreaming: false,
        onError: (err) => {
            console.error("Bedrock error:", err);
        },
    });
}
