"use server";

import { generateOriginal, type GenerateOriginalOutcome } from "@/server/distribution/generation/original";
import { createGenerationRuntimeDeps } from "@/server/distribution/generation/runtime";

export async function generateOriginalAction(formData: FormData): Promise<GenerateOriginalOutcome> {
  return generateOriginal(createGenerationRuntimeDeps(), formData);
}
