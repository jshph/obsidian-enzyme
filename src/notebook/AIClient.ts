import OpenAI from 'openai'
import { RegistrationManager } from './RegistrationManager'
import { Notice } from 'obsidian'
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParams
} from 'openai/resources'
import { APIPromise } from 'openai/core'
import { Stream } from 'openai/streaming'

export type ModelConfig = {
	model: string
	baseURL: string
	apiKey: string
}

export class AIClient {
	openai: OpenAI

	constructor(public registrationManager: RegistrationManager) {}

	async initAIClient(modelConfig: ModelConfig) {
		// Check that the config has been initialized and whether the user might be trying to use a non-GPT-3.5 Turbo model without a license
		if (
			modelConfig.model &&
			!(await this.registrationManager.validateLicense()) &&
			modelConfig.model !== 'gpt-3.5-turbo-1106'
		) {
			new Notice(
				'You must have a valid Reason license key to use non GPT-3.5 Turbo models.'
			)
			return
		}
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
