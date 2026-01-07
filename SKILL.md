---
name: proofread
description: This skill should be used when the user says "proofread", "spell check", "check spelling", "check grammar", "proofread this document", "review for typos", "proofread my article", "check this for errors", or mentions proofreading a markdown file.
---

# Proofread skill

AI-powered proofreading using Gemini Flash. Checks spelling, grammar, style, and clarity in markdown documents using British English conventions.

## How it works

1. **Safe corrections auto-applied**: Spelling, punctuation, and clear grammar errors are fixed automatically
2. **Style/clarity as suggestions**: Flagged with IDs (S1, S2, etc.) for manual review
3. **Interactive acceptance**: User types suggestion IDs to accept them

## Workflow

### Step 1: Ask for proofreading level

When the user wants to proofread a document, ask:

> What level of proofreading do you want?
>
> **Level 1 — Mechanical only**: Spelling, punctuation, grammar (fast, minimal output)
> **Level 2 — Light style pass**: Level 1 + top 5-10 style/clarity suggestions (recommended)
> **Level 3 — Comprehensive**: All style/clarity suggestions (thorough, more output)

### Step 2: Run the proofreading script

```bash
cd ~/.claude/skills/proofread && npx tsx scripts/proofread.ts "<file_path>" --level <1|2|3>
```

The script outputs JSON to stdout. Parse it and present to the user.

### Step 3: Present results

Format the output like this:

```
## Proofreading complete: <filename>

**Auto-applied (<count> corrections):**
- Line <n>: "<from>" → "<to>"
- ...

**Suggestions for review:**
- [S1] Line <n>: <description>
- [S2] Line <n>: <description>
- ...

Corrected file saved to: <filename>.proofread.md

**To accept suggestions**, type their IDs (e.g., "S1 S3") or "all", or "none" to skip.
```

### Step 4: Apply accepted suggestions

When the user provides IDs:

```bash
cd ~/.claude/skills/proofread && npx tsx scripts/apply-suggestions.ts "<file>.proofread.md" <S1 S2 ...>
```

Or if they say "all":
```bash
cd ~/.claude/skills/proofread && npx tsx scripts/apply-suggestions.ts "<file>.proofread.md" all
```

### Step 5: Confirm completion

```
Final file saved to: <filename>.final.md

Applied: S1, S3
Removed: S2, S4
```

## First-time setup

If the user hasn't installed dependencies yet:

```bash
cd ~/.claude/skills/proofread && yarn install
```

## Configuration

The skill uses these environment variables from `.env`:
- `GOOGLE_AI_API_KEY`: Google AI API key for Gemini
- `PROOFREAD_MODEL`: Model ID (default: gemini-3-flash-preview)

## Output files

- `<filename>.proofread.md`: Auto-corrections applied, suggestions as HTML comments
- `<filename>.final.md`: After accepting/rejecting suggestions

## Notes

- Uses British English conventions
- Preserves author's voice and technical terminology
- Processes long documents in chunks automatically
- Progress shown via stderr, results via stdout (JSON)

## Update check

This is a shared skill. Before executing, check `~/.claude/skills/.update-config.json`.
If `auto_check_enabled` is true and `last_checked_timestamp` is older than `check_frequency_days`,
mention: "It's been a while since skill updates were checked. Run `/update-skills` to see available updates."
Do NOT perform network operations - just check the local timestamp.
