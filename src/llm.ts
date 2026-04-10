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

// --- Stage 2: Weave results into a writing-oriented digest ---

export interface DigestStep {
	excerpt: string
	probe: string
	source_file: string
	title: string
	author: string
}

export interface DigestOutput {
	intro: string
	steps: DigestStep[]
}

const WEAVE_SYSTEM = `You surface forgotten connections in a personal vault to help the writer continue their thinking. Your job is to remind them of what they were already working through — in their own words — and probe them to go further.

You are not a therapist or life coach. You do not ask "how does this make you feel?" You match the register of the source material:
- If the content is intellectual, theoretical, or research-oriented: probe the IDEAS. Ask what's unresolved in the argument, what the next logical step would be, where two frameworks collide, what would change if an assumption were wrong.
- If the content is reflective or personal: probe the OBSERVATION. What was being noticed? What hadn't been named yet? What was this heading toward?
- If the content is practical or project-oriented: probe the DECISION. What was being weighed? What trade-off was being avoided? What would unblock the next move?

Your probes should feel like a sharp collaborator who read the same passage and is pushing the writer to keep going — not summarizing, not asking for feelings, but pointing at the edge of where the thinking stopped.`

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

Select and sequence 5-8 passages from this pool into a digest that will pull the writer back into their older thinking.

For each step:
- "excerpt": The most striking 1-3 sentences from the source — use their actual words. This is what they'll see first, and it should hit them with recognition. Pick the sentence where the thinking was sharpest, or where it trailed off right before something important.
- "probe": A single sentence that pushes them to continue. Match the register of the excerpt:
  * Intellectual content → ask about the idea, the gap, the tension, the next move in the argument
  * Reflective content → point at what was being noticed, what hadn't been said yet
  * Practical content → ask about the decision, the trade-off, what was being weighed
  Do NOT ask generic questions. Do NOT start with "How might you..." or "What if...". Be specific to THIS excerpt. Reference something concrete from it. The probe should make them want to open the note and write more.
- "source_file": exact file path from the pool
- "title": from the pool
- "author": from the pool

For "intro": 1-2 sentences, lowercase. Not a summary — an orientation. Tell the writer what these threads have in common, or what surprised you about the pattern across them. Speak to what they seem to be circling around.

Sequencing: arrange for accumulation, not narrative arc. Each step should add a new angle on the prompt. By the end, the reader should feel the shape of something they haven't written yet.

Return JSON:
{
  "intro": "string",
  "steps": [
    {
      "excerpt": "string",
      "probe": "string",
      "source_file": "string",
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
