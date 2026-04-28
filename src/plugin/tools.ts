/**
 * Obsidian-native tool implementations.
 *
 * These replace the Node fs-based tools from the CLI with Obsidian vault API
 * calls. This ensures Obsidian detects changes immediately without filesystem
 * polling delays, and respects vault abstractions (e.g. .obsidian exclusion).
 *
 * VaultSearch stays as the enzyme CLI wrapper (child_process) since it calls
 * an external binary. ReadFile and WriteFile use app.vault directly.
 */

import { App, TFile } from 'obsidian'
import type { Tool, ToolResult } from '../core/types.js'

export function createObsidianReadFileTool(app: App): Tool {
  return {
    definition: {
      name: 'ReadFile',
      description: 'Read a vault file by path. Use paths from VaultSearch results. Never guess paths.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path relative to vault root (e.g. "Articles/Title by Author.md")',
        },
      },
      required: ['path'],
    },
    async execute(args): Promise<ToolResult> {
      const filePath = args.path as string

      // Security: reject path traversal
      if (filePath.includes('..')) {
        return { content: 'Path traversal not allowed.', isError: true }
      }

      const file = app.vault.getAbstractFileByPath(filePath)
      if (!file || !(file instanceof TFile)) {
        return { content: `File not found: ${filePath}`, isError: true }
      }

      try {
        const content = await app.vault.read(file)
        const MAX_CHARS = 1500
        if (content.length > MAX_CHARS) {
          return {
            content: `${content.slice(0, MAX_CHARS)}\n\n[Truncated — ${content.length} chars total. First ${MAX_CHARS} shown.]`,
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

export function createObsidianWriteFileTool(app: App): Tool {
  return {
    definition: {
      name: 'WriteFile',
      description: 'Write or create a file in the vault.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path relative to vault root',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['path', 'content'],
    },
    async execute(args): Promise<ToolResult> {
      const filePath = args.path as string
      const content = args.content as string

      if (filePath.includes('..')) {
        return { content: 'Path traversal not allowed.', isError: true }
      }

      try {
        const existing = app.vault.getAbstractFileByPath(filePath)
        if (existing instanceof TFile) {
          await app.vault.modify(existing, content)
        } else {
          // Create parent folders if needed
          const parts = filePath.split('/')
          if (parts.length > 1) {
            let dirPath = ''
            for (let i = 0; i < parts.length - 1; i++) {
              dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i]
              if (!app.vault.getAbstractFileByPath(dirPath)) {
                await app.vault.createFolder(dirPath)
              }
            }
          }
          await app.vault.create(filePath, content)
        }
        return { content: `Wrote ${content.length} chars to ${filePath}`, isError: false }
      } catch (err) {
        return {
          content: `Failed to write: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    },
  }
}
