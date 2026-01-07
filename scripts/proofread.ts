#!/usr/bin/env npx tsx

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

// Load environment variables
config({ path: join(dirname(new URL(import.meta.url).pathname), "..", ".env") });

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const MODEL = process.env.PROOFREAD_MODEL || "gemini-3-flash-preview";

if (!GOOGLE_AI_API_KEY) {
  console.error("Error: GOOGLE_AI_API_KEY not set in .env file");
  process.exit(1);
}

const google = createGoogleGenerativeAI({
  apiKey: GOOGLE_AI_API_KEY,
});

interface Change {
  line: number;
  type: "spelling" | "grammar" | "punctuation";
  from: string;
  to: string;
  context?: string;
}

interface Suggestion {
  id: string;
  line: number;
  type: "style" | "clarity";
  text: string;
  suggested: string | null;
  context?: string;
}

interface ProofreadResult {
  file: string;
  correctedFile: string;
  level: number;
  autoApplied: {
    count: number;
    changes: Change[];
  };
  suggestions: Suggestion[];
}

// Estimate tokens (rough: 1 token ≈ 4 chars for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Split text into chunks if needed
function chunkText(text: string, maxTokens: number = 6000): string[] {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) {
    return [text];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(line);
    currentTokens += lineTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
}

function buildPrompt(text: string, level: number, startLine: number): string {
  const levelInstructions = {
    1: `Focus ONLY on:
- Spelling errors
- Punctuation errors
- Clear grammar mistakes (subject-verb agreement, tense consistency, etc.)

Do NOT suggest style or clarity improvements.`,
    2: `Focus on:
- Spelling errors (auto-correct)
- Punctuation errors (auto-correct)
- Clear grammar mistakes (auto-correct)
- Top 5-10 most impactful style/clarity issues (as suggestions)

For style/clarity, only flag the most important issues like:
- Very long sentences (>40 words)
- Confusing pronoun references
- Passive voice where active would be much clearer`,
    3: `Provide comprehensive proofreading:
- Spelling errors (auto-correct)
- Punctuation errors (auto-correct)
- Clear grammar mistakes (auto-correct)
- All style suggestions (long sentences, passive voice, word choice)
- All clarity suggestions (ambiguous pronouns, unclear references, jargon)

Be thorough but preserve the author's voice.`,
  };

  return `You are a professional proofreader. Review the following text using British English conventions.

${levelInstructions[level as 1 | 2 | 3]}

IMPORTANT RULES:
1. Line numbers start at ${startLine} for this chunk
2. For AUTO-CORRECTIONS (spelling, punctuation, grammar): These will be applied automatically
3. For SUGGESTIONS (style, clarity): These require manual review
4. Preserve the author's voice and technical terminology
5. Don't over-edit - only flag genuine issues
6. For each issue, provide the exact line number where it occurs

Respond in this exact JSON format:
{
  "autoCorrections": [
    {"line": <number>, "type": "spelling|grammar|punctuation", "from": "<original>", "to": "<corrected>", "context": "<surrounding text>"}
  ],
  "suggestions": [
    {"line": <number>, "type": "style|clarity", "text": "<description of issue>", "suggested": "<suggested fix or null if just flagging>", "context": "<surrounding text>"}
  ]
}

TEXT TO PROOFREAD:
\`\`\`
${text}
\`\`\``;
}

async function proofreadChunk(
  text: string,
  level: number,
  startLine: number
): Promise<{ autoCorrections: Change[]; suggestions: Suggestion[] }> {
  const prompt = buildPrompt(text, level, startLine);

  try {
    const { text: response } = await generateText({
      model: google(MODEL),
      prompt,
      maxTokens: 4000,
    });

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());
    return {
      autoCorrections: parsed.autoCorrections || [],
      suggestions: parsed.suggestions || [],
    };
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return { autoCorrections: [], suggestions: [] };
  }
}

function applyAutoCorrections(text: string, corrections: Change[]): string {
  const lines = text.split("\n");

  // Sort corrections by line number descending to avoid index shifts
  const sorted = [...corrections].sort((a, b) => b.line - a.line);

  for (const correction of sorted) {
    const lineIndex = correction.line - 1;
    if (lineIndex >= 0 && lineIndex < lines.length) {
      lines[lineIndex] = lines[lineIndex].replace(correction.from, correction.to);
    }
  }

  return lines.join("\n");
}

function insertSuggestionComments(text: string, suggestions: Suggestion[]): string {
  const lines = text.split("\n");

  // Sort by line number descending to avoid index shifts
  const sorted = [...suggestions].sort((a, b) => b.line - a.line);

  for (const suggestion of sorted) {
    const lineIndex = suggestion.line - 1;
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const comment = `<!-- [${suggestion.id}] REVIEW: ${suggestion.text}${
        suggestion.suggested ? ` Suggested: "${suggestion.suggested}"` : ""
      } -->`;
      // Insert comment at end of the line
      lines[lineIndex] = lines[lineIndex] + " " + comment;
    }
  }

  return lines.join("\n");
}

async function proofread(
  filePath: string,
  level: number
): Promise<ProofreadResult> {
  const text = readFileSync(filePath, "utf-8");
  const fileName = basename(filePath);
  const fileDir = dirname(filePath);
  const correctedFileName = fileName.replace(/\.md$/, ".proofread.md");
  const correctedFilePath = join(fileDir, correctedFileName);

  const chunks = chunkText(text);
  const allAutoCorrections: Change[] = [];
  const allSuggestions: Suggestion[] = [];

  let currentLine = 1;
  let suggestionCounter = 1;

  for (let i = 0; i < chunks.length; i++) {
    console.error(`Processing chunk ${i + 1}/${chunks.length}...`);

    const { autoCorrections, suggestions } = await proofreadChunk(
      chunks[i],
      level,
      currentLine
    );

    allAutoCorrections.push(...autoCorrections);

    // Assign IDs to suggestions
    for (const suggestion of suggestions) {
      allSuggestions.push({
        ...suggestion,
        id: `S${suggestionCounter++}`,
      });
    }

    currentLine += chunks[i].split("\n").length;
  }

  // Apply auto-corrections
  let correctedText = applyAutoCorrections(text, allAutoCorrections);

  // Insert suggestion comments
  correctedText = insertSuggestionComments(correctedText, allSuggestions);

  // Write corrected file
  writeFileSync(correctedFilePath, correctedText, "utf-8");

  return {
    file: fileName,
    correctedFile: correctedFileName,
    level,
    autoApplied: {
      count: allAutoCorrections.length,
      changes: allAutoCorrections,
    },
    suggestions: allSuggestions,
  };
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx proofread.ts <file.md> [--level 1|2|3]");
    console.error("");
    console.error("Levels:");
    console.error("  1 - Mechanical only (spelling, punctuation, grammar)");
    console.error("  2 - Light style pass (+ top 5-10 style suggestions)");
    console.error("  3 - Comprehensive review (all suggestions)");
    process.exit(1);
  }

  const filePath = args[0];
  let level = 2; // Default to level 2

  const levelIndex = args.indexOf("--level");
  if (levelIndex !== -1 && args[levelIndex + 1]) {
    level = parseInt(args[levelIndex + 1], 10);
    if (level < 1 || level > 3) {
      console.error("Error: Level must be 1, 2, or 3");
      process.exit(1);
    }
  }

  try {
    const result = await proofread(filePath, level);
    // Output JSON to stdout for Claude to parse
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
