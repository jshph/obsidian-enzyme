/**
 * Tool result clearing.
 *
 * When the agent searches the vault or reads files, the results can
 * be large. On an 8K context window, a single VaultSearch result
 * (~500 tokens) is 6% of the budget. After a few turns, old results
 * crowd out space for new conversation.
 *
 * Solution: replace old tool results with one-line stubs that preserve
 * what was done (tool name + preview) but free the tokens.
 *
 * Claude Code calls this "microcompact". Their implementation is
 * time-based and configurable per tool type. Ours is simpler: keep
 * the N most recent results, stub everything older.
 */

import type { Message, ToolResultMessage } from '../core/types.js'

/**
 * Replace old tool results with stubs, keeping the `keep` most recent.
 * Returns a new array (does not mutate the input).
 */
export function clearOldToolResults(messages: Message[], keep: number): Message[] {
  // Collect indices of all tool result messages
  const indices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool_result') indices.push(i)
  }

  if (indices.length <= keep) return messages

  // Everything except the last `keep` results gets stubbed
  const toStub = new Set(indices.slice(0, -keep))

  return messages.map((msg, i) => {
    if (!toStub.has(i) || msg.role !== 'tool_result') return msg
    return { ...msg, content: stubFor(msg) }
  })
}

function stubFor(msg: ToolResultMessage): string {
  const preview = msg.content.slice(0, 80).replace(/\n/g, ' ')
  return `[${msg.toolName} result cleared — ${preview}${msg.content.length > 80 ? '...' : ''}]`
}
