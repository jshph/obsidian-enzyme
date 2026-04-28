/**
 * VaultSearch — semantic search via Enzyme.
 *
 * This tool wraps `enzyme catalyze`, which searches by concept rather
 * than keyword. It works by matching the query against "catalysts" —
 * AI-generated thematic questions anchored to entities in the vault.
 *
 * Use VaultSearch when the user asks about a theme or idea:
 *   "What have I written about feeling stuck?"
 *   "tension between efficiency and presence"
 *
 * Do NOT use it for exact text (names, tags, links) — that's TextSearch.
 *
 * This is the Enzyme-specific tool. To swap in a different search
 * backend, replace this file. The Tool interface stays the same.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Tool, ToolResult } from '../core/types.js'

const exec = promisify(execFile)

export function createVaultSearchTool(vaultPath: string): Tool {
  return {
    definition: {
      name: 'VaultSearch',
      description:
        'Search the vault by concept using Enzyme. Finds notes that resonate with ' +
        'the query by meaning, not keyword. Use for themes, ideas, and questions.',
      parameters: {
        query: {
          type: 'string',
          description: 'The concept, theme, or question to search for',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 5)',
        },
      },
      required: ['query'],
    },

    async execute(args): Promise<ToolResult> {
      const query = args.query as string
      const limit = (args.limit as number) || 5

      try {
        const { stdout } = await exec(
          'enzyme',
          ['catalyze', query, '-n', String(limit), '-p', vaultPath],
          { timeout: 30_000 },
        )
        return { content: formatResults(stdout, vaultPath), isError: false }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('not initialized')) {
          return { content: 'Vault not indexed. Run `enzyme init` first.', isError: true }
        }
        return { content: `Search failed: ${msg}`, isError: true }
      }
    },
  }
}

/**
 * Format enzyme's JSON output into a token-efficient string.
 * The model sees this as the tool result — keep it concise but useful.
 */
function formatResults(stdout: string, vaultPath: string): string {
  const response = JSON.parse(stdout)
  const results = (response.results || []) as Array<{
    file_path: string
    content: string
    similarity: number
  }>

  if (results.length === 0) return 'No results found.'

  // Each result: relative path (without .md for wikilink compatibility)
  // + similarity + excerpt (capped at 300 chars)
  const formatted = results.map(r => {
    const path = r.file_path.replace(vaultPath + '/', '').replace(/\.md$/, '')
    const excerpt = r.content.trim()
    return `**[[${path}]]** (${(r.similarity * 100).toFixed(0)}%)\n${excerpt}`
  })

  // Append the top contributing catalysts — these explain WHY
  // results surfaced and help the model frame its response.
  const catalysts = (response.top_contributing_catalysts || [])
    .slice(0, 3)
    .map((c: any) => `- ${c.text} (${c.entity})`)

  let output = formatted.join('\n\n---\n\n')
  if (catalysts.length > 0) {
    output += `\n\nConnecting themes:\n${catalysts.join('\n')}`
  }
  return output
}
