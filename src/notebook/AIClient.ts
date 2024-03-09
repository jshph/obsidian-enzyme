import OpenAI from 'openai'
import { Notice } from 'obsidian'
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParams
} from 'openai/resources'
import { APIPromise } from 'openai/core'
import { Stream } from 'openai/streaming'

export type ModelConfig = {
	label: string
	model: string
	baseURL: string
	apiKey: string
}

export class AIClient {
	openai: OpenAI

	constructor() {}

	async initAIClient(modelConfig: ModelConfig) {
		this.openai = new OpenAI({
			...{
				...modelConfig,
				model: undefined
			},
			dangerouslyAllowBrowser: true
		})
	}

	createCompletion(
		payload: ChatCompletionCreateParams
	): APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
		return this.openai.chat.completions.create(payload)
	}
}
