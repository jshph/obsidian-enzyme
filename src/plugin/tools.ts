/**
 * Obsidian-native tool implementations.
 *
 * These replace the Node fs-based tools from the CLI with Obsidian vault API
 * calls. This ensures Obsidian detects changes immediately without filesystem
 * polling delays, and respects vault abstractions (e.g. .obsidian exclusion).
 *
 * VaultSearch stays as an enzyme CLI wrapper (child_process) since it calls
 * an external binary. ReadFile and WriteFile use app.vault directly.
 */

import { App, TFile } from 'obsidian'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile as nodeExecFile } from 'child_process'
import { promisify } from 'util'
import type { Tool, ToolResult } from '@jshph/digest'

const execFileAsync = promisify(nodeExecFile)

export function createObsidianVaultSearchTool(vaultPath: string): Tool {
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
      const cmd = getEnzymeCommand()
      const commandArgs = ['catalyze', query, '-n', String(limit), '-p', vaultPath]

      try {
        const { stdout, stderr } = await execFile(cmd, commandArgs, 30_000)
        if (stderr.trim()) {
          console.warn(`Enzyme command stderr: ${cmd} ${commandArgs.join(' ')}\n${stderr.trim()}`)
        }
        return { content: formatVaultSearchResults(stdout, vaultPath, query), isError: false }
      } catch (err) {
        logToolCommandError(cmd, commandArgs, err)
        const msg = getErrorMessage(err)
        if (msg.includes('not initialized')) {
          return { content: 'Vault not indexed. Run `enzyme init` first.', isError: true }
        }
        return { content: `Search failed: ${msg}`, isError: true }
      }
    },
  }
}

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

function getEnzymeCommand(): string {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.cargo', 'bin', 'enzyme'),
    path.join(home, '.local', 'bin', 'enzyme'),
    '/opt/homebrew/bin/enzyme',
    '/usr/local/bin/enzyme',
  ]

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Try the next preferred install location.
    }
  }

  return 'enzyme'
}

async function execFile(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, { timeout })
}

function formatVaultSearchResults(stdout: string, vaultPath: string, query: string): string {
  const response = JSON.parse(stdout)
  const results = (response.results || []) as Array<{
    file_path: string
    content: string
    similarity: number
  }>

  if (results.length === 0) {
    const catalysts = (response.top_contributing_catalysts || []) as Array<{ text?: string; entity?: string }>
    console.warn(
      `VaultSearch returned no results for "${query}". ` +
      `top_contributing_catalysts=${catalysts.length}`
    )
    if (catalysts.length > 0) {
      console.warn(`VaultSearch catalysts:\n${catalysts
        .slice(0, 5)
        .map(c => `- ${c.text || '(missing text)'} (${c.entity || 'unknown'})`)
        .join('\n')}`)
    }
    return 'No results found.'
  }

  const formatted = results.map(r => {
    const path = r.file_path.replace(`${vaultPath}/`, '')
    const noteLink = toWikiLink(path)
    const excerpt = r.content.trim()
    return `${noteLink} (${(r.similarity * 100).toFixed(0)}%)\n${excerpt}`
  })

  const catalysts = (response.top_contributing_catalysts || [])
    .slice(0, 3)
    .map((c: { text?: string; entity?: string }) => `- ${c.text || '(missing text)'} (${c.entity || 'unknown'})`)

  let output = formatted.join('\n\n---\n\n')
  if (catalysts.length > 0) {
    output += `\n\nConnecting themes:\n${catalysts.join('\n')}`
  }
  return output
}

function logToolCommandError(cmd: string, args: string[], err: unknown): void {
  const command = `${cmd} ${args.join(' ')}`
  const commandError = err as {
    code?: unknown
    stdout?: unknown
    stderr?: unknown
  }
  const parts = [
    `Enzyme command failed: ${command}`,
    typeof commandError.code === 'number' ? `exit code: ${commandError.code}` : '',
    typeof commandError.stdout === 'string' && commandError.stdout.trim() ? `stdout:\n${commandError.stdout.trim()}` : '',
    typeof commandError.stderr === 'string' && commandError.stderr.trim() ? `stderr:\n${commandError.stderr.trim()}` : '',
    getErrorMessage(err),
  ].filter(Boolean)

  console.error(parts.join('\n'))
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function toWikiLink(path: string): string {
  const withoutExt = path.replace(/\.md$/i, '')
  const label = withoutExt.split('/').pop() || withoutExt
  return `[[${withoutExt}|${label}]]`
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
