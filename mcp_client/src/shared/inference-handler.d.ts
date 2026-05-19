import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { type UIMessage } from "ai";
export type InferenceParams = {
    model: string;
    messages: UIMessage[];
    system_message: string;
    max_tokens: number;
    tools: Tool[];
    resources: any[];
    prompts: any[];
};
export declare function createInferenceHandler(params: InferenceParams): Promise<import("ai").StreamTextResult<{
    [k: string]: {
        description: string;
        parameters: import("ai").Schema<unknown> | {
            type: string;
        };
    };
}, never>>;
