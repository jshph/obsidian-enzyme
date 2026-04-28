/**
 * WriteFile tool — create or overwrite a markdown file in the vault.
 */

import { writeFile, readFile, mkdir } from 'fs/promises'
import { resolve, relative, dirname } from 'path'
import type { Tool, ToolResult } from '../core/types.js'

export function createWriteFileTool(vaultPath: string): Tool {
  return {
    definition: {
      name: 'WriteFile',
      description: 'Write or create a file in the vault.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path (relative to vault root or absolute)',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (args): Promise<ToolResult> => {
      const filePath = args.path as string
      const content = args.content as string
      const absPath = resolve(vaultPath, filePath)

      // Security: ensure within vault
      if (relative(vaultPath, resolve(absPath)).startsWith('..')) {
        return { content: 'Path is outside the vault.', isError: true }
      }

      try {
        await mkdir(dirname(absPath), { recursive: true })
        await writeFile(absPath, content, 'utf-8')
        const relPath = relative(vaultPath, absPath)
        return {
          content: `Wrote ${content.length} chars to ${relPath}`,
          isError: false,
        }
      } catch (err) {
        return {
          content: `Failed to write: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}
