/**
 * ReadFile tool — read a markdown file from the vault.
 */

import { readFile } from 'fs/promises'
import { resolve, relative } from 'path'
import type { Tool, ToolResult } from '../core/types.js'

export function createReadFileTool(vaultPath: string): Tool {
  return {
    definition: {
      name: 'ReadFile',
      description: 'Read a vault file by path. Use paths from VaultSearch results. Never guess paths.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path from a search result (e.g. "Articles/Title by Author.md").',
        },
      },
      required: ['path'],
    },
    execute: async (args): Promise<ToolResult> => {
      const filePath = args.path as string
      const absPath = resolve(vaultPath, filePath)

      // Security: ensure the resolved path is within the vault
      const rel = relative(vaultPath, absPath)
      if (rel.startsWith('..') || resolve(absPath) !== absPath.replace(/\/$/, '')) {
        // Re-check with resolve to handle symlinks
        if (relative(vaultPath, resolve(absPath)).startsWith('..')) {
          return { content: 'Path is outside the vault.', isError: true }
        }
      }

      try {
        const content = await readFile(absPath, 'utf-8')

        // Truncate to save context — VaultSearch excerpts cover
        // most needs; ReadFile is for when you need more detail.
        const MAX_CHARS = 1500
        if (content.length > MAX_CHARS) {
          const truncated = content.slice(0, MAX_CHARS)
          return {
            content: `${truncated}\n\n[Truncated — ${content.length} chars total. First ${MAX_CHARS} shown.]`,
            isError: false,
          }
        }

        return { content, isError: false }
      } catch (err) {
        return {
          content: `Failed to read: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}
