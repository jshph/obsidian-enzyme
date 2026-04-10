import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'
import type { EnzymeDigestSettings } from './settings'

export interface EnzymeResult {
	file_path: string
	content: string
	similarity: number
}

export interface CatalyzeOutput {
	results: EnzymeResult[]
	top_contributing_catalysts?: any[]
	query: string
}

// Resolve enzyme binary — Obsidian's Electron doesn't inherit shell PATH
function findEnzymeBinary(): string {
	const candidates = [
		join(homedir(), '.local', 'bin', 'enzyme'),
		'/usr/local/bin/enzyme',
		'/opt/homebrew/bin/enzyme',
		join(homedir(), '.cargo', 'bin', 'enzyme'),
	]
	const fs = require('fs')
	for (const c of candidates) {
		try {
			fs.accessSync(c, fs.constants.X_OK)
			return c
		} catch {}
	}
	return 'enzyme'
}

let _enzymeBin: string | null = null
function enzymeBin(): string {
	if (!_enzymeBin) _enzymeBin = findEnzymeBinary()
	return _enzymeBin
}

function enzymeEnv(): Record<string, string | undefined> {
	return {
		...process.env,
		PATH: `${process.env.PATH || ''}:${join(homedir(), '.local', 'bin')}:/usr/local/bin:/opt/homebrew/bin`,
	}
}

/**
 * Shell out to `enzyme catalyze` with the given query.
 */
export function enzymeCatalyze(
	query: string,
	settings: EnzymeDigestSettings
): Promise<EnzymeResult[]> {
	return new Promise((resolve, reject) => {
		const args = ['catalyze', query, '-n', String(settings.highlightsPerQuery)]
		if (settings.vaultPath) {
			args.push('-p', settings.vaultPath)
		}

		const bin = enzymeBin()
		execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, env: enzymeEnv() }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`enzyme catalyze failed (${bin}): ${stderr || error.message}`))
				return
			}
			try {
				const data: CatalyzeOutput = JSON.parse(stdout)
				resolve(data.results || [])
			} catch (e) {
				reject(new Error(`Failed to parse enzyme output: ${e}`))
			}
		})
	})
}

/**
 * Run `enzyme init` on a vault. Returns a promise that resolves with stdout
 * or rejects with the error. Streams progress via onProgress callback.
 */
export function enzymeInit(
	vaultPath: string,
	onProgress?: (msg: string) => void
): Promise<string> {
	return new Promise((resolve, reject) => {
		const bin = enzymeBin()
		const args = ['init', '-p', vaultPath, '--json-progress']

		const child = require('child_process').spawn(bin, args, {
			env: enzymeEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (chunk: Buffer) => {
			const text = chunk.toString()
			stdout += text
			if (onProgress) {
				// Parse JSON progress lines
				for (const line of text.split('\n').filter((l: string) => l.trim())) {
					try {
						const ev = JSON.parse(line)
						if (ev.stage) onProgress(ev.stage)
						else if (ev.message) onProgress(ev.message)
					} catch {
						onProgress(line.trim())
					}
				}
			}
		})

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString()
		})

		child.on('close', (code: number) => {
			if (code !== 0) {
				reject(new Error(`enzyme init failed (exit ${code}): ${stderr || stdout}`))
			} else {
				resolve(stdout)
			}
		})

		child.on('error', (err: Error) => {
			reject(new Error(`Failed to start enzyme: ${err.message}`))
		})
	})
}

/**
 * Run `enzyme refresh --quiet` on a vault. Lightweight incremental update.
 */
export function enzymeRefresh(vaultPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const bin = enzymeBin()
		const args = ['refresh', '--quiet', '-p', vaultPath]

		execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, env: enzymeEnv() }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`enzyme refresh failed: ${stderr || error.message}`))
				return
			}
			resolve(stdout)
		})
	})
}

/**
 * Check if a vault has been initialized (has .enzyme/enzyme.db).
 */
export function isVaultIndexed(vaultPath: string): boolean {
	const fs = require('fs')
	const dbPath = join(vaultPath, '.enzyme', 'enzyme.db')
	try {
		fs.accessSync(dbPath)
		return true
	} catch {
		return false
	}
}

export interface EnrichedResult {
	file_path: string
	content: string
	similarity: number
	title: string
	author: string
}

/**
 * Run multiple catalyze queries in parallel, deduplicate and cap per-source.
 */
export async function catalyzePool(
	queries: string[],
	settings: EnzymeDigestSettings
): Promise<EnrichedResult[]> {
	const results = await Promise.allSettled(
		queries.map((q) => enzymeCatalyze(q, settings))
	)

	const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
	if (failures.length === results.length) {
		throw new Error(failures[0].reason?.message || 'All enzyme queries failed')
	}

	const allResults = results
		.filter((r): r is PromiseFulfilledResult<EnzymeResult[]> => r.status === 'fulfilled')
		.map((r) => r.value)

	const seen = new Set<string>()
	const sourceCount: Record<string, number> = {}
	const pool: EnrichedResult[] = []

	for (const results of allResults) {
		for (const r of results) {
			const key = `${r.file_path}::${r.content.slice(0, 200)}`
			if (seen.has(key)) continue
			seen.add(key)

			const count = sourceCount[r.file_path] || 0
			if (count >= settings.maxPerSource) continue
			sourceCount[r.file_path] = count + 1

			const { author, title } = extractAuthorTitle(r.file_path)
			pool.push({ ...r, author, title })
		}
	}

	return pool
}

function extractAuthorTitle(filePath: string): { author: string; title: string } {
	const parts = filePath.replace(/\\/g, '/').split('/')
	const filename = parts[parts.length - 1] || ''
	const title = filename.replace(/\.md$/, '')
	const parent = parts.length >= 2 ? parts[parts.length - 2] : ''

	if (parent === 'Tweets' && title.startsWith('Tweets From ')) {
		return { author: title.replace('Tweets From ', ''), title: 'Tweets' }
	}

	return { author: parent || 'Unknown', title }
}
