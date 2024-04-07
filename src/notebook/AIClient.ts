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
		// start proxy server
		if (this.server) {
			this.server.stop()
		}
		let baseURL
		if (modelConfig.model.includes('claude')) {
			this.server = new ProxyServer('https://api.anthropic.com/v1', proxyPort)
			baseURL = localBaseURL
		} else if (modelConfig.model.includes('gpt')) {
			this.server = new ProxyServer('https://api.openai.com', proxyPort)
			baseURL = localBaseURL
		} else {
			baseURL = modelConfig.baseURL
		}

		const provider = modelConfig.model.includes('claude')
			? 'anthropic'
			: 'openai'

		this.llmClient = createLLMClient({
			...modelConfig,
			dangerouslyAllowBrowser: true,
			baseURL,
			provider
		})

		this.llmClient.baseURL = baseURL
	}

	createCompletion(
		payload: ChatCompletionCreateParams
	): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
		return this.llmClient.chat.completions.create(payload)
	}
}
