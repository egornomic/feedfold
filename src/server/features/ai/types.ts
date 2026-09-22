import type { AiGrounding, AiModelOption, AiProvider, AiUsage } from "../../../shared/types.js";

interface AiGenerationRequest {
  apiKey: string;
  model: string;
  system: string;
  input: string;
  videoUrl?: string;
  maxOutputTokens: number;
  webSearch: boolean;
  signal: AbortSignal;
}

export interface AiGenerationResult {
  text: string;
  usage: AiUsage;
  grounding: AiGrounding | null;
}

export interface AiProviderAdapter {
  id: AiProvider;
  label: string;
  defaultModel: string;
  models: readonly AiModelOption[];
  generateText(request: AiGenerationRequest): Promise<AiGenerationResult>;
}
