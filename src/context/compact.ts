/**
 * Conversation compaction.
 *
 * When the conversation approaches the context limit, older messages
 * are summarized into a single SystemCompactMessage. Recent exchanges
 * are kept verbatim so the model doesn't lose the current thread.
 *
 * The approach, adapted from Claude Code:
 *
 *   1. Keep the last N user/assistant exchanges intact
 *   2. Send everything older to the LLM with a summarization prompt
 *   3. Strip the LLM's <analysis> scratchpad (if present)
 *   4. Replace the old messages with one SystemCompactMessage
 *
 * The summary prompt asks the model to preserve specific things that
 * matter for writing work: ideas, themes, vault paths, the user's
 * voice, and where things left off. This is different from Claude
 * Code's summary (which focuses on code snippets, errors, and edits).
 */

import type {
  AgentConfig,
  LLMMessage,
  Message,
  SystemCompactMessage,
} from '../core/types.js'

const DEFAULT_COMPACT_PROMPT = `Respond with TEXT ONLY. Do NOT call any tools.

Summarize this conversation for continuing the session. Focus on:

1. What the user is working on (the writing project, idea, or exploration)
2. Key ideas, themes, and connections discovered
3. Vault content referenced (file paths and key excerpts worth preserving)
4. The user's voice and style preferences observed
5. Where things left off — what was being drafted or explored
6. Next direction (only if clear from context)

Keep the summary under 500 words. Preserve specific quotes, file paths, and thematic language rather than generalizing. The goal is to pick up the thread without re-explaining.

REMINDER: Respond with plain text only. Do NOT call any tools.`

/**
 * Summarize older messages and return a compacted conversation.
 * Keeps the last 2 exchanges; summarizes everything before them.
 */
export async function compactMessages(
  messages: Message[],
  config: AgentConfig,
): Promise<{ messages: Message[]; summary: string }> {
  const keepCount = countMessagesForExchanges(messages, 2)
  let toSummarize = messages.slice(0, messages.length - keepCount)
  let toKeep = messages.slice(messages.length - keepCount)

  // Edge case: nothing old enough to summarize. Emergency: keep only 1 exchange.
  if (toSummarize.length === 0) {
    const emergencyKeep = countMessagesForExchanges(messages, 1)
    toSummarize = messages.slice(0, messages.length - emergencyKeep)
    toKeep = messages.slice(messages.length - emergencyKeep)
    if (toSummarize.length === 0) return { messages, summary: '' }
  }

  const summary = await summarize(toSummarize, config)
  const boundary: SystemCompactMessage = {
    role: 'system_compact',
    summary,
    timestamp: Date.now(),
  }
  return { messages: [boundary, ...toKeep], summary }
}

/**
 * Count how many messages from the end contain N user messages
 * (each user message roughly starts an "exchange").
 */
function countMessagesForExchanges(messages: Message[], exchanges: number): number {
  let userCount = 0
  let i = messages.length - 1
  while (i >= 0 && userCount < exchanges) {
    if (messages[i].role === 'user') userCount++
    i--
  }
  return messages.length - (i + 1)
}

/**
 * Use the LLM to generate a summary of the older messages.
 */
async function summarize(messages: Message[], config: AgentConfig): Promise<string> {
  const prompt = config.context.compactPrompt || DEFAULT_COMPACT_PROMPT

  // Flatten messages into a readable transcript
  const transcript = messages.map(msg => {
    switch (msg.role) {
      case 'user':        return `User: ${msg.content}`
      case 'assistant':   return `Assistant: ${msg.content.map(b => b.type === 'text' ? b.text : `[${b.type}]`).join('')}`
      case 'tool_result': return `[Tool: ${msg.toolName}] ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`
      case 'system_compact': return `[Earlier summary] ${msg.summary}`
    }
  }).join('\n\n')

  // Call the LLM with no tools (text-only response)
  const stream = config.provider.stream(
    [{ text: prompt, cache: false }],
    [{ role: 'user', content: `Conversation to summarize:\n\n${transcript}` }],
    [],
  )

  let text = ''
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.text
    } else if (event.type === 'done') {
      text = event.message.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
      break
    }
  }

  // Strip <analysis> scratchpad if the model used one (Claude Code pattern)
  return text.replace(/<analysis>[\s\S]*?<\/analysis>/g, '').trim()
}
