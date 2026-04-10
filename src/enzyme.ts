import { execFile, spawn } from 'child_process'
import { accessSync, constants as fsConstants } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import type { EnzymeDigestSettings } from './settings'

export interface EnzymeResult {
	file_path: string
	content: string
	similarity: number
}

interface CatalyzeOutput {
	results: EnzymeResult[]
	query: string
}

const MAX_BUFFER = 1024 * 1024 // 1MB — enzyme output is typically a few KB

const ENZYME_CANDIDATES = [
	join(homedir(), '.local', 'bin', 'enzyme'),
	'/usr/local/bin/enzyme',
	'/opt/homebrew/bin/enzyme',
	join(homedir(), '.cargo', 'bin', 'enzyme'),
]

function findEnzymeBinary(): string | null {
	for (const c of ENZYME_CANDIDATES) {
		try {
			accessSync(c, fsConstants.X_OK)
			return c
		} catch {}
	}
	return null
}

let _enzymeBin: string | null | undefined = undefined
function enzymeBin(): string {
	if (_enzymeBin === undefined) _enzymeBin = findEnzymeBinary()
	if (!_enzymeBin) {
		throw new Error('Enzyme CLI is not installed. Install it from enzyme.garden/setup')
	}
	return _enzymeBin
}

export function isEnzymeInstalled(): boolean {
	if (_enzymeBin === undefined) _enzymeBin = findEnzymeBinary()
	return _enzymeBin !== null
}

/** Re-check after install */
export function clearEnzymeCache(): void {
	_enzymeBin = undefined
}

export function installEnzyme(): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('sh', ['-c', 'curl -fsSL https://enzyme.garden/install.sh | sh'], {
			env: enzymeEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let stderr = ''
		child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

		child.on('close', (code: number) => {
			if (code !== 0) {
				reject(new Error(`Install failed (exit ${code}): ${stderr}`))
			} else {
				clearEnzymeCache()
				resolve()
			}
		})

		child.on('error', (err: Error) => {
			reject(new Error(`Failed to run installer: ${err.message}`))
		})
	})
}

let _enzymeEnv: Record<string, string | undefined> | null = null
function enzymeEnv(): Record<string, string | undefined> {
	if (!_enzymeEnv) {
		_enzymeEnv = {
			...process.env,
			PATH: `${process.env.PATH || ''}:${join(homedir(), '.local', 'bin')}:/usr/local/bin:/opt/homebrew/bin`,
		}
	}
	return _enzymeEnv
}

export function enzymeCatalyze(
	query: string,
	settings: EnzymeDigestSettings
): Promise<EnzymeResult[]> {
	return new Promise((resolve, reject) => {
		const args = ['catalyze', query, '-n', String(settings.highlightsPerQuery)]
		if (settings.vaultPath) {
			args.push('-p', settings.vaultPath)
		}

		execFile(enzymeBin(), args, { maxBuffer: MAX_BUFFER, env: enzymeEnv() }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`enzyme catalyze failed: ${stderr || error.message}`))
				return
			}
			try {
				const data: CatalyzeOutput = JSON.parse(stdout)
				resolve(data.results || [])
			} catch {
				reject(new Error('Failed to parse enzyme catalyze output'))
			}
		})
	})
}

export function enzymeInit(
	vaultPath: string,
	onProgress?: (msg: string) => void
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(enzymeBin(), ['init', '-p', vaultPath, '--json-progress'], {
			env: enzymeEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		})

		let stdout = ''
		let stderr = ''

		child.stdout.on('data', (chunk: Buffer) => {
			const text = chunk.toString()
			stdout += text
			if (onProgress) {
				for (const line of text.split('\n').filter((l: string) => l.trim())) {
					try {
						const ev = JSON.parse(line)
						onProgress(ev.stage || ev.message || line.trim())
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

export function enzymeRefresh(vaultPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(enzymeBin(), ['refresh', '--quiet', '-p', vaultPath], {
			maxBuffer: MAX_BUFFER,
			env: enzymeEnv(),
		}, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`enzyme refresh failed: ${stderr || error.message}`))
				return
			}
			resolve(stdout)
		})
	})
}

export function isVaultIndexed(vaultPath: string): boolean {
	try {
		accessSync(join(vaultPath, '.enzyme', 'enzyme.db'))
		return true
	} catch {
		return false
	}
}

export interface EnrichedResult {
	file_path: string
	content: string
	similarity: number
	noteName: string
	created: string | null
}

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

	for (const batch of allResults) {
		for (const r of batch) {
			const key = `${r.file_path}::${r.content.slice(0, 200)}`
			if (seen.has(key)) continue
			seen.add(key)

			const count = sourceCount[r.file_path] || 0
			if (count >= settings.maxPerSource) continue
			sourceCount[r.file_path] = count + 1

			pool.push({ ...r, noteName: basename(r.file_path, '.md'), created: null })
		}
	}

	return pool
}
