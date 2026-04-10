import type { EnzymeDigestSettings } from './settings'
import type { EnrichedResult } from './enzyme'

interface LLMMessage {
	role: 'system' | 'user' | 'assistant'
	content: string
}

async function llmCall(
	messages: LLMMessage[],
	settings: EnzymeDigestSettings
): Promise<string> {
	const resp = await fetch(`${settings.baseURL}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${settings.apiKey}`,
		},
		body: JSON.stringify({
			model: settings.model,
			messages,
			temperature: 0.8,
			response_format: { type: 'json_object' },
		}),
	})

	if (!resp.ok) {
		const body = await resp.text()
		throw new Error(`LLM API error ${resp.status}: ${body}`)
	}

	const data = await resp.json()
	return data.choices?.[0]?.message?.content || ''
}

// --- Stage 1: Generate search queries from the user's prompt ---

const QUERY_SYSTEM = `You generate diverse semantic search queries from a user's prompt. The queries will be used to search a personal knowledge vault of notes, highlights, and ideas. Cast a wide net across different registers to maximize retrieval diversity.`

function queryUserPrompt(prompt: string, numQueries: number): string {
	return `The user wants to explore their vault with this prompt:

"${prompt}"

Generate exactly ${numQueries} search queries, each using a DIFFERENT angle to maximize source diversity. Each query should be 1-2 sentences.

Use these registers (pick ${numQueries} from these, or blend):
1. CONCRETE/SENSORY — specific objects, textures, physical details
2. SOCIAL/RELATIONAL — human dynamics, relationships, interactions
3. TEMPORAL/PROCESS — change, rhythm, sequences, evolution of ideas
4. SYSTEMIC/STRUCTURAL — systems, frameworks, architectures, patterns
5. EXISTENTIAL/PHILOSOPHICAL — abstract, metaphorical, paradoxical

Rules:
- Ground queries in the user's prompt but explore different facets
- Vary your phrasing — don't start all queries the same way
- Make queries specific enough for semantic search, not vague

Return JSON: { "queries": ["query1", "query2", ...] }`
}

export async function generateQueries(
	prompt: string,
	settings: EnzymeDigestSettings
): Promise<string[]> {
	const raw = await llmCall(
		[
			{ role: 'system', content: QUERY_SYSTEM },
			{ role: 'user', content: queryUserPrompt(prompt, settings.numQueries) },
		],
		settings
	)

	try {
		const parsed = JSON.parse(raw)
		return parsed.queries || []
	} catch {
		throw new Error(`Failed to parse query generation response: ${raw.slice(0, 200)}`)
	}
}

// --- Stage 2: Weave results into a digest ---

export interface DigestStep {
	excerpt: string
	question: string
	bridge: string
	source_file: string
	title: string
	author: string
}

export interface DigestOutput {
	intro: string
	steps: DigestStep[]
}

const WEAVE_SYSTEM = `You are a knowledge archaeologist who surfaces forgotten connections in a personal vault. You sequence reading highlights and notes into a digest that provokes the reader to revisit and build on older thinking. Your style is sparse, evocative, lowercase — meaning emerges from arrangement, not explanation. Each step should pose a question that makes the reader want to click through and re-engage with the source material.`

function weaveUserPrompt(prompt: string, pool: EnrichedResult[]): string {
	const poolText = pool
		.map(
			(r, i) =>
				`[${i}] source: ${r.author} — ${r.title} (${r.file_path})\n${r.content.slice(0, 1500)}`
		)
		.join('\n\n')

	return `The user's exploration prompt: "${prompt}"

<highlight_pool>
${poolText}
</highlight_pool>

From this pool, select and sequence 5-8 highlights into a digest that will make the reader revisit their older thinking.

For each step:
- Extract the most evocative 1-3 sentences as the excerpt
- Pose a question that the excerpt raises — something that makes the reader want to click through to the source note and think further
- Write a bridge: a single line of sparse, lowercase text connecting to the next step
- Include the source_file path, title, and author

For the intro: 1-2 sentences, all lowercase, free-associative. Acknowledge that these threads were already in the reader's vault, waiting to be woven together.

Sequencing: create tension and resonance, not logical argument. Move through different facets. Allow meaning to emerge from arrangement.

Return JSON matching this schema:
{
  "intro": "string",
  "steps": [
    {
      "excerpt": "string (1-3 sentences from the source)",
      "question": "string (a question this raises, inviting the reader to revisit)",
      "bridge": "string (sparse lowercase connector to next step)",
      "source_file": "string (file path from the pool)",
      "title": "string",
      "author": "string"
    }
  ]
}`
}

export async function weaveDigest(
	prompt: string,
	pool: EnrichedResult[],
	settings: EnzymeDigestSettings
): Promise<DigestOutput> {
	const raw = await llmCall(
		[
			{ role: 'system', content: WEAVE_SYSTEM },
			{ role: 'user', content: weaveUserPrompt(prompt, pool) },
		],
		settings
	)

	try {
		const parsed = JSON.parse(raw)
		if (!parsed.intro || !Array.isArray(parsed.steps)) {
			throw new Error('Missing intro or steps')
		}
		return parsed as DigestOutput
	} catch (e) {
		throw new Error(`Failed to parse digest response: ${e}`)
	}
}
