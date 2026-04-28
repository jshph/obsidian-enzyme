/**
 * System prompt construction with cache-aware block structure.
 *
 * The prompt is split into CACHED and UNCACHED blocks:
 *
 *   CACHED (stable across turns, gets KV-cache hits):
 *     Block 1: identity + tool guidance + context guidance
 *     Block 2: enzyme petri overview (constant for session)
 *
 *   UNCACHED (may change per turn):
 *     Block 3: memory (user may update mid-session)
 *     Block 4: date / env
 *
 * The provider places cache_control: { type: 'ephemeral' } on the LAST
 * cached block. Everything before it is the prefix that gets cached.
 * Tool definitions are also cached by the API automatically.
 *
 * This means: system prompt + tools + petri = cached prefix.
 * Only memory/date/messages vary per turn.
 * On a 5-turn conversation with VaultSearch calls, turns 2-5 get full
 * cache hits on the prefix — time to first token drops dramatically.
 */

import type { SystemPromptBlock } from '../core/types.js'

export interface PromptConfig {
  vaultName?: string
  enzymeOverview?: string  // Pre-warmed petri output (stable for session)
  memoryContent?: string   // MEMORY.md content (may change)
  date?: string
}

export function buildSystemPrompt(config: PromptConfig = {}): SystemPromptBlock[] {
  const date = config.date || new Date().toISOString().split('T')[0]
  const blocks: SystemPromptBlock[] = []

  // --- CACHED BLOCK (stable across turns) ---
  //
  // Identity + tool guidance + context guidance + petri overview are merged
  // into a SINGLE cached block. This ensures the cached prefix exceeds
  // Haiku's 1,024 token minimum for cache activation. Splitting into
  // multiple small blocks risks each being under the threshold.

  const cachedParts = [getIdentity(), getToolGuidance(), getContextGuidance()]

  if (config.enzymeOverview) {
    const header = config.vaultName
      ? `# Vault "${config.vaultName}" — topics (NOT note titles)`
      : '# Vault topics (NOT note titles)'
    cachedParts.push(`${header}\nThese are topics in the vault, not notes. Do not reference them as notes or quote them. Search to find actual notes.\n${config.enzymeOverview}`)
  }

  blocks.push({
    text: cachedParts.join('\n\n'),
    cache: true,
  })

  // --- UNCACHED BLOCKS (may change per turn) ---

  // Block 3: Memory (user may ask to update mid-session)
  if (config.memoryContent) {
    blocks.push({
      text: `# Memory\n${config.memoryContent}`,
      cache: false,
    })
  }

  // Block 4: Date/environment (changes daily, trivially small)
  const envParts = [`Date: ${date}`]
  if (config.vaultName) envParts.push(`Vault: ${config.vaultName}`)
  blocks.push({
    text: envParts.join('\n'),
    cache: false,
  })

  return blocks
}

function getIdentity(): string {
  return `You are a writing and thinking assistant. You work with the user's vault of markdown notes to help them develop ideas, draft writing, and explore connections.

When exploring ideas, surface connections the user might not see. When drafting, match the user's voice from their existing writing. When organizing, respect their existing structure (tags, links, folders).`
}

function getToolGuidance(): string {
  return `The vault overview is in the system context above. Each turn, catalyst questions and entity names may appear as "[Vault context for this conversation]".

DEFAULT: respond from what you already have. Search results, vault context, and conversation history are usually enough. Synthesize, connect, and go deeper into existing material before reaching for new searches.

Search ONLY when the user introduces a topic with NO relevant results already in the conversation. If results from a previous search touch on what the user is asking about — even tangentially — work with those instead.

Tools:
- VaultSearch: semantic search. Expensive — returns large excerpts. Use only for genuinely new topics.
- ReadFile: read a specific note the user wants to explore in detail.

After responding, offer 2-3 specific notes to explore further. Lead with insight, not process.

NEVER fabricate note titles, quotes, or content. Only reference notes you found via tool results. If you haven't searched yet, say what topics are available and offer to search.`
}

function getContextGuidance(): string {
  return `Context is limited. When you find important content, quote key passages in your response — old tool results will be cleared to make room. If the conversation is summarized, pick up where it left off without re-explaining.

When quoting or referencing vault content, ALWAYS cite the source as an Obsidian wikilink so users can click through:
- Link the note after a quote: use \`[[path/to/Note]]\` (without .md extension)
- If the excerpt is under a heading, link to it: \`[[path/to/Note#Heading Name]]\`
- If a block reference ID appears in the excerpt (like \`^abc123\`), link to it: \`[[path/to/Note#^abc123]]\`
- For a brief inline mention, use \`[[Note|display text]]\` aliased links

Example: after quoting a passage, end with "— [[Articles/On Presence]]" or "— [[Articles/On Presence#The tension between efficiency]]"`
}
