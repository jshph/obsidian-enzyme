import { ModelConfig } from '../notebook'

export interface ReasonSettings {
	models: ModelConfig[]
	selectedModel: string
	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	localModelPath?: string
}

export const DEFAULT_SETTINGS: ReasonSettings = {
	models: [
		{
			label: 'GPT-3.5 Turbo',
			model: 'gpt-3.5-turbo-1106',
			apiKey: null,
			baseURL: null
		},
		{
			label: 'GPT-4',
			model: 'gpt-4-0125-preview',
			apiKey: null,
			baseURL: null
		}
	],
	selectedModel: 'GPT-3.5 Turbo',
	debug: false,
	localModelPath: undefined
}
