/**
 * Token estimation.
 *
 * We use a rough character-based estimate rather than calling a
 * tokenizer. This is intentional: the estimate is only used to
 * decide when to compact, and being off by 10-20% is fine for that.
 * What matters is that the estimate is fast (no I/O) and conservative
 * (overestimates slightly, so we compact before overflowing).
 */

import type { ContextConfig, Message } from '../core/types.js'

/** ~3.5 chars per token for English text. Intentionally conservative. */
export function roughTokenEstimate(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/** Estimate tokens for a single message (including structural overhead). */
export function estimateMessageTokens(
  msg: Message,
  estimate: (text: string) => number = roughTokenEstimate,
): number {
  switch (msg.role) {
    case 'user':
      return estimate(msg.content) + 4
    case 'assistant':
      return msg.content.reduce((sum, block) => {
        if (block.type === 'text') return sum + estimate(block.text)
        if (block.type === 'thinking') return sum + estimate(block.text)
        if (block.type === 'tool_call') return sum + estimate(JSON.stringify(block.arguments)) + 20
        return sum
      }, 4)
    case 'tool_result':
      return estimate(msg.content) + 10
    case 'system_compact':
      return estimate(msg.summary) + 20
  }
}

/** Should we trigger compaction at this token count? */
export function shouldCompact(tokens: number, config: ContextConfig): boolean {
  return tokens >= config.maxTokens * config.compactThreshold
}
