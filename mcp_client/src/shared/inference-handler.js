"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInferenceHandler = void 0;
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
exports.createInferenceHandler = createInferenceHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mZXJlbmNlLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZlcmVuY2UtaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyREFBaUQ7QUFFakQsMkJBQTREO0FBWXJELEtBQUssVUFBVSxzQkFBc0IsQ0FBQyxNQUF1QjtJQUNsRSxNQUFNLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEdBQUcsTUFBTSxDQUFDO0lBRTFGLHFDQUFxQztJQUNyQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUNqQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7UUFDZCxPQUFPO1lBQ0wsQ0FBQyxDQUFDLElBQUk7WUFDTjtnQkFDRSxXQUFXLEVBQUUsQ0FBQyxDQUFDLFdBQVc7Z0JBQzFCLFVBQVUsRUFBRSxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxJQUFBLGVBQVUsRUFBQyxDQUFDLENBQUMsV0FBa0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7YUFDbEY7U0FDRixDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQ0gsQ0FBQztJQUVGLG1EQUFtRDtJQUNuRCxJQUFJLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1FBQ3hCLFFBQVEsQ0FBQyxZQUFZLEdBQUc7WUFDdEIsV0FBVyxFQUFFLG1FQUFtRSxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUN2SSxVQUFVLEVBQUUsSUFBQSxlQUFVLEVBQUM7Z0JBQ3JCLElBQUksRUFBRSxRQUFRO2dCQUNkLFVBQVUsRUFBRTtvQkFDVixHQUFHLEVBQUU7d0JBQ0gsSUFBSSxFQUFFLFFBQVE7d0JBQ2QsV0FBVyxFQUFFLDZCQUE2QjtxQkFDM0M7aUJBQ0Y7Z0JBQ0QsUUFBUSxFQUFFLENBQUMsS0FBSyxDQUFDO2FBQ2xCLENBQUM7U0FDSCxDQUFDO0tBQ0g7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUN0QixRQUFRLENBQUMsU0FBUyxHQUFHO1lBQ25CLFdBQVcsRUFBRSxtREFBbUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDN0gsVUFBVSxFQUFFLElBQUEsZUFBVSxFQUFDO2dCQUNyQixJQUFJLEVBQUUsUUFBUTtnQkFDZCxVQUFVLEVBQUU7b0JBQ1YsSUFBSSxFQUFFO3dCQUNKLElBQUksRUFBRSxRQUFRO3dCQUNkLFdBQVcsRUFBRSwyQkFBMkI7cUJBQ3pDO29CQUNELFNBQVMsRUFBRTt3QkFDVCxJQUFJLEVBQUUsUUFBUTt3QkFDZCxXQUFXLEVBQUUsMEJBQTBCO3FCQUN4QztpQkFDRjtnQkFDRCxRQUFRLEVBQUUsQ0FBQyxNQUFNLENBQUM7YUFDbkIsQ0FBQztTQUNILENBQUM7S0FDSDtJQUVELCtCQUErQjtJQUMvQixPQUFPLElBQUEsZUFBVSxFQUFDO1FBQ2hCLEtBQUssRUFBRSxJQUFBLHdCQUFPLEVBQUMsS0FBSyxDQUFDO1FBQ3JCLFFBQVE7UUFDUixNQUFNLEVBQUUsY0FBYztRQUN0QixTQUFTLEVBQUUsVUFBVTtRQUNyQixLQUFLLEVBQUUsUUFBUTtRQUNmLGlCQUFpQixFQUFFLEtBQUs7UUFDeEIsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBbEVELHdEQWtFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGJlZHJvY2sgfSBmcm9tIFwiQGFpLXNkay9hbWF6b24tYmVkcm9ja1wiO1xuaW1wb3J0IHR5cGUgeyBUb29sIH0gZnJvbSBcIkBtb2RlbGNvbnRleHRwcm90b2NvbC9zZGsvdHlwZXMuanNcIjtcbmltcG9ydCB7IGpzb25TY2hlbWEsIHN0cmVhbVRleHQsIHR5cGUgVUlNZXNzYWdlIH0gZnJvbSBcImFpXCI7XG5cbmV4cG9ydCB0eXBlIEluZmVyZW5jZVBhcmFtcyA9IHtcbiAgbW9kZWw6IHN0cmluZztcbiAgbWVzc2FnZXM6IFVJTWVzc2FnZVtdO1xuICBzeXN0ZW1fbWVzc2FnZTogc3RyaW5nO1xuICBtYXhfdG9rZW5zOiBudW1iZXI7XG4gIHRvb2xzOiBUb29sW107XG4gIHJlc291cmNlczogYW55W107XG4gIHByb21wdHM6IGFueVtdO1xufTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUluZmVyZW5jZUhhbmRsZXIocGFyYW1zOiBJbmZlcmVuY2VQYXJhbXMpIHtcbiAgY29uc3QgeyBtb2RlbCwgbWVzc2FnZXMsIHN5c3RlbV9tZXNzYWdlLCBtYXhfdG9rZW5zLCB0b29scywgcmVzb3VyY2VzLCBwcm9tcHRzIH0gPSBwYXJhbXM7XG5cbiAgLy8gQ29udmVydCBNQ1AgdG9vbHMgdG8gQUkgU0RLIGZvcm1hdFxuICBjb25zdCBtY3BUb29scyA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICB0b29scy5tYXAoKHQpID0+IHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHQubmFtZSxcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiB0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHBhcmFtZXRlcnM6IHQuaW5wdXRTY2hlbWEgPyBqc29uU2NoZW1hKHQuaW5wdXRTY2hlbWEgYXMgYW55KSA6IHsgdHlwZTogXCJvYmplY3RcIiB9LFxuICAgICAgICB9LFxuICAgICAgXTtcbiAgICB9KVxuICApO1xuXG4gIC8vIEFkZCByZWFkUmVzb3VyY2UgdG9vbCBpZiByZXNvdXJjZXMgYXJlIGF2YWlsYWJsZVxuICBpZiAocmVzb3VyY2VzLmxlbmd0aCA+IDApIHtcbiAgICBtY3BUb29scy5yZWFkUmVzb3VyY2UgPSB7XG4gICAgICBkZXNjcmlwdGlvbjogYFJlYWQgY29udGVudCBmcm9tIGF2YWlsYWJsZSBNQ1AgcmVzb3VyY2VzLiBBdmFpbGFibGUgcmVzb3VyY2VzOiAke3Jlc291cmNlcy5tYXAociA9PiBgJHtyLm5hbWV9ICgke3IudXJpfSlgKS5qb2luKCcsICcpfWAsXG4gICAgICBwYXJhbWV0ZXJzOiBqc29uU2NoZW1hKHtcbiAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIHVyaToge1xuICAgICAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIlVSSSBvZiB0aGUgcmVzb3VyY2UgdG8gcmVhZFwiXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICByZXF1aXJlZDogW1widXJpXCJdXG4gICAgICB9KSxcbiAgICB9O1xuICB9XG5cbiAgLy8gQWRkIGdldFByb21wdCB0b29sIGlmIHByb21wdHMgYXJlIGF2YWlsYWJsZVxuICBpZiAocHJvbXB0cy5sZW5ndGggPiAwKSB7XG4gICAgbWNwVG9vbHMuZ2V0UHJvbXB0ID0ge1xuICAgICAgZGVzY3JpcHRpb246IGBHZXQgYW5kIGV4ZWN1dGUgTUNQIHByb21wdHMuIEF2YWlsYWJsZSBwcm9tcHRzOiAke3Byb21wdHMubWFwKHAgPT4gYCR7cC5uYW1lfSAtICR7cC5kZXNjcmlwdGlvbn1gKS5qb2luKCcsICcpfWAsXG4gICAgICBwYXJhbWV0ZXJzOiBqc29uU2NoZW1hKHtcbiAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIG5hbWU6IHtcbiAgICAgICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJOYW1lIG9mIHRoZSBwcm9tcHQgdG8gZ2V0XCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIGFyZ3VtZW50czoge1xuICAgICAgICAgICAgdHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkFyZ3VtZW50cyBmb3IgdGhlIHByb21wdFwiXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICByZXF1aXJlZDogW1wibmFtZVwiXVxuICAgICAgfSksXG4gICAgfTtcbiAgfVxuXG4gIC8vIENyZWF0ZSB0aGUgc3RyZWFtVGV4dCByZXN1bHRcbiAgcmV0dXJuIHN0cmVhbVRleHQoe1xuICAgIG1vZGVsOiBiZWRyb2NrKG1vZGVsKSxcbiAgICBtZXNzYWdlcyxcbiAgICBzeXN0ZW06IHN5c3RlbV9tZXNzYWdlLFxuICAgIG1heFRva2VuczogbWF4X3Rva2VucyxcbiAgICB0b29sczogbWNwVG9vbHMsXG4gICAgdG9vbENhbGxTdHJlYW1pbmc6IGZhbHNlLFxuICAgIG9uRXJyb3I6IChlcnIpID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJCZWRyb2NrIGVycm9yOlwiLCBlcnIpO1xuICAgIH0sXG4gIH0pO1xufVxuIl19