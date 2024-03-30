import * as http from 'http'
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

export class AIClient {
	llmClient: LLMClient<'openai' | 'anthropic'>
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
		this.server = new ProxyServer(baseURL, 3000)

		const provider = modelConfig.model.includes('claude')
			? 'anthropic'
			: 'openai'

		this.llmClient = createLLMClient({
			...modelConfig,
			dangerouslyAllowBrowser: true,
			baseURL: 'http://localhost:3000',
			provider
		})

		// TODO???
		this.llmClient.baseURL = 'http://localhost:3000'
	}

	createCompletion(
		payload: ChatCompletionCreateParams
	): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
		return this.llmClient.chat.completions.create(payload)
	}
}
