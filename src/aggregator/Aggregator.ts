import { Notice } from 'obsidian'
import { ChatCompletionMessage } from '../types'
import { AIClient } from '../notebook'

/**
 * The `Aggregator` class is responsible for managing the aggregation of chat messages
 * and generating responses using an AI model. It interacts with the `AIClient` to
 * create completions based on the provided messages and system prompts.
 *
 * @property {string} assistantId - A placeholder ID for the assistant, currently set to 'DUMMY'.
 * @property {AIClient} aiClient - The AI client used for making requests to the AI service.
 * @property {() => string} getModel - A function that returns the current AI model in use.
 * @property {string} systemPrompt - The system prompt template used for generating AI completions.
 * @property {string} instructions - Additional instructions to be included in the system prompt.
 */
export class Aggregator {
	assistantId: string

	constructor(
		public aiClient: AIClient,
		public getModel: () => string,
		private systemPrompt: string,
		private instructions: string
	) {
		this.assistantId = 'DUMMY' // TODO once assistant API supports streaming
	}

	/**
	 * Generates responses from a series of chat messages using the AI model.
	 *
	 * @param {ChatCompletionMessage[]} messages - An array of chat completion messages to be processed.
	 * @returns {Promise<AsyncIterable<string>>} - An async iterable that yields generated message strings.
	 */
	async generateFromMessages(
		messages: ChatCompletionMessage[],
		useLegacy: boolean = true
	): Promise<AsyncIterable<string>> {
		try {
			if (useLegacy) {
				console.log(messages)
				return this.generateFromMessagesLegacy(
					messages as ChatCompletionMessage[]
				)
			}
		} catch (error) {
			new Notice(`Error calling GPT: ${error.message || error}`)
			console.error(error.message || error)
		}
	}

	private async generateFromMessagesLegacy(
		messages: ChatCompletionMessage[]
	): Promise<AsyncIterable<string>> {
		messages.unshift({
			role: 'system',
			content: this.systemPrompt.replace('{instructions}', this.instructions)
		})

		const generated = await this.aiClient.createCompletion({
			model: this.getModel(),
			messages: messages as any,
			temperature: 0.8,
			max_tokens: 1000,
			logit_bias: { 4: 1 },
			stream: true
		})
		return (async function* () {
			if (Symbol.asyncIterator in generated) {
				for await (const chunk of generated) {
					yield chunk.choices[0]?.delta.content || ''
				}
			} else {
				throw new TypeError('The generated object is not async iterable')
			}
		})()
	}
}
