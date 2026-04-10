import type { EnzymeDigestSettings } from './settings'
import type { EnrichedResult } from './enzyme'

interface LLMMessage {
	role: 'system' | 'user' | 'assistant'
	content: string
}

const LLM_TIMEOUT_MS = 90_000

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
		signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
	})

	if (!resp.ok) {
		const body = await resp.text()
		throw new Error(`LLM API error ${resp.status}: ${body.slice(0, 300)}`)
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
	note_name: string
	date: string | null
	is_external: boolean
	attribution: string | null
}

export interface DigestOutput {
	intro: string
	steps: DigestStep[]
}

const WEAVE_SYSTEM = `You surface forgotten connections in a personal vault to help the writer continue their thinking.

The pool contains notes from different parts of the vault. Some are the writer's own notes and reflections. Others are highlights the writer saved from books, articles, podcasts, and tweets — you can tell from the file path (e.g. paths containing "Readwise", "Books", "Articles", "Tweets", or filenames with "Highlights" are external sources the writer imported). Use the full file path to make this judgment.

Your job is to remind them of what they were already working through — using their own words where possible, and connecting those to things they've read. When you include a saved highlight from something they read, the connection should feel earned: it should resonate with or challenge something from the writer's own notes.

CRITICAL RULES FOR PROBES:
- Do NOT ask abstract, ideological questions like "what new elements might become part of X?" or "what shifts in the relationship between X and Y?"
- Do NOT paraphrase catalyst questions from the pool. Write your own.
- INSTEAD, be specific. Name a concrete detail, experience, or idea from the excerpt and ask about its relationship to something else in the pool. Point at where two ideas collide, where an experience contradicts a theory, where the writer said one thing here and something different there.
- Good probe: "You wrote about friction as empowering here, but in [other note] you described removing friction from the receipt printer workflow — what's the actual boundary?"
- Bad probe: "How might productive friction reshape the future of interface design?"
- If the content is intellectual: probe the specific tension, the gap in the argument, the unstated assumption
- If the content is from experience: probe what was noticed, what happened next, what this reminded them of
- Probes should make the writer want to open the note and add to it

You MUST include at least 1-2 highlights from external sources (books, articles, tweets the writer saved — identifiable from the path). These should feel like meaningful resonances with the writer's own thinking, not filler.`

function weaveUserPrompt(prompt: string, pool: EnrichedResult[]): string {
	const poolText = pool
		.map((r, i) => {
			const dateLine = r.created ? ` | created: ${r.created}` : ''
			return `[${i}] file: ${r.file_path}${dateLine}\n${r.content.slice(0, 1500)}`
		})
		.join('\n\n')

	return `The user's exploration prompt: "${prompt}"

<pool>
${poolText}
</pool>

Select and sequence 5-8 passages from this pool into a digest. You MUST include at least 1-2 passages from external sources (books, articles, tweets the writer saved — you can identify these from the file path, e.g. paths containing "Readwise", "Books", "Articles", "Tweets", or filenames with "Highlights").

For each step:
- "excerpt": 1-3 sentences from the source. Pick where the thinking was sharpest or trailed off.
- "probe": A specific sentence that pushes them to continue. Reference concrete details from THIS excerpt and, where possible, connect to another passage in the pool. No generic questions. No "How might you..." or "What if...". Be as specific as the content allows.
- "source_file": exact file path from the pool
- "note_name": a human-readable name for this note. Use the filename (without .md), but clean it up for display — e.g. a timestamp filename like "2025-08-09-11-12-39" can stay as-is, but "A Crazy Holy Grace by Frederick Buechner Highlights" should just be the title.
- "date": use the "created" date provided in the pool metadata (YYYY-MM-DD format), or null if not provided
- "is_external": true if this is from an imported source (Readwise, highlights from a book/article/tweet), false if it's the writer's own note. Infer from the file path.
- "attribution": for external sources, the author or source name (infer from the filename and content). For the writer's own notes, null.

For "intro": 1-2 sentences, lowercase. Not a summary. Tell the writer what pattern you see across these fragments — what they seem to be circling around, and where it connects to things they've read.

Sequence by date when possible — show the writer the arc of their thinking over time. The reader should see how their ideas evolved, and where their reading intersected with their own development.

Return JSON:
{
  "intro": "string",
  "steps": [
    {
      "excerpt": "string",
      "probe": "string",
      "source_file": "string",
      "note_name": "string",
      "date": "string or null",
      "is_external": true/false,
      "attribution": "string or null"
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
