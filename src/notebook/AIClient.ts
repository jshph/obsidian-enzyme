import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParams
} from 'openai/resources'
import { APIPromise } from 'openai/core'
import { Stream } from 'openai/streaming'
import { createLLMClient, LLMClient } from 'llm-polyglot'
import { ProxyServer } from './ProxyServer'

export type ModelConfig = {
	label: string
	model: string
	baseURL: string
	apiKey: string
}

const proxyPort = 3000
const localBaseURL = `http://localhost:${proxyPort}`

// TODO hacky, but to handle llm-polyglot
interface LLMClientWithBase extends LLMClient<'anthropic' | 'openai'> {
	baseURL: string
	chat: any
}
export class AIClient {
	llmClient: LLMClientWithBase

	private server: ProxyServer

	constructor() {}

	async initAIClient(modelConfig: ModelConfig) {
		const baseURL = modelConfig.model.includes('claude')
			? 'https://api.anthropic.com/v1'
			: 'https://api.openai.com'

		// start proxy server
		if (this.server) {
			this.server.stop()
		}
		this.server = new ProxyServer(baseURL, proxyPort)

		const provider = modelConfig.model.includes('claude')
			? 'anthropic'
			: 'openai'

		this.llmClient = createLLMClient({
			...modelConfig,
			dangerouslyAllowBrowser: true,
			baseURL: localBaseURL,
			provider
		})

		this.llmClient.baseURL = localBaseURL
	}

	createCompletion(
		payload: ChatCompletionCreateParams
	): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
		return this.llmClient.chat.completions.create(payload)
	}
}
