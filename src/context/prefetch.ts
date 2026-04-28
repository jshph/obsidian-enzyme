/**
 * Vault context pre-fetch via Enzyme.
 *
 * Runs `enzyme catalyze` on the user's recent messages before the LLM
 * sees the prompt. Injects catalyst questions and entity names as a
 * lightweight routing signal — NOT full content.
 *
 * The model uses this to decide whether/how to call VaultSearch
 * (conceptual, informed by catalyst questions) and TextSearch
 * (exact match, informed by entity names as #tags/[[wikilinks]]).
 * Both can fire in parallel on turn 1.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Message, PrefetchResult, UserMessage } from '../core/types.js'

const exec = promisify(execFile)

/**
 * Create a prefetch function for a given vault path.
 * Pass the returned function as `config.prefetch` in AgentConfig.
 */
export function createEnzymePrefetch(vaultPath: string) {
  return async (recentMessages: Message[]): Promise<PrefetchResult | null> => {
    // Build a search query from recent user messages.
    // Using the last 3 gives the model topical continuity —
    // if the conversation has evolved, the query reflects that.
    const userTexts = recentMessages
      .filter((m): m is UserMessage => m.role === 'user')
      .map(m => m.content)
    // Strip vault syntax (#tags, [[wikilinks]]) from the query.
    // These are entity anchors meant for TextSearch (grep), not catalyze.
    // Catalyze works on concepts — "founding" not "#founding".
    const raw = userTexts.join(' ').slice(0, 500)
    const query = raw
      .replace(/\[\[([^\]]+)\]\]/g, '$1')  // [[link]] → link
      .replace(/#([\w/.-]+)/g, '$1')        // #tag → tag
      .trim()

    if (!query.trim()) return null

    try {
      const { stdout } = await exec(
        'enzyme',
        ['catalyze', query, '-n', '5', '-p', vaultPath],
        { timeout: 15_000 },
      )

      const response = JSON.parse(stdout)
      const results = (response.results || []) as Array<{
        file_path: string
        content: string
        similarity: number
      }>

      const catalysts = (response.top_contributing_catalysts || [])
        .slice(0, 5)
        .map((c: any) => `- ${c.text} [${c.entity}]`)

      if (catalysts.length === 0) return null

      // Collect unique entity names for TextSearch targeting
      const entities = [...new Set(
        (response.top_contributing_catalysts || [])
          .slice(0, 5)
          .map((c: any) => c.entity as string)
      )]

      let content = `Relevant tensions in the vault:\n${catalysts.join('\n')}`
      if (entities.length > 0) {
        content += `\n\nRelated vault entities (use as #tags or [[wikilinks]] with TextSearch): ${entities.join(', ')}`
      }
      return { content, source: 'enzyme catalyze' }
    } catch {
      return null // Enzyme not available or query failed — not an error
    }
  }
}
