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
	// Check if any exist synchronously
	const fs = require('fs')
	for (const c of candidates) {
		try {
			fs.accessSync(c, fs.constants.X_OK)
			return c
		} catch {}
	}
	// Fallback to bare name (hope PATH works)
	return 'enzyme'
}

let _enzymeBin: string | null = null
function enzymeBin(): string {
	if (!_enzymeBin) _enzymeBin = findEnzymeBinary()
	return _enzymeBin
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
		const env = {
			...process.env,
			PATH: `${process.env.PATH || ''}:${join(homedir(), '.local', 'bin')}:/usr/local/bin:/opt/homebrew/bin`,
		}

		execFile(bin, args, { maxBuffer: 10 * 1024 * 1024, env }, (error, stdout, stderr) => {
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

	// If ALL queries failed, throw the first error so the user sees it
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
