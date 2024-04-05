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
			label: 'Haiku',
			model: 'claude-3-haiku-20240307',
			baseURL: null,
			apiKey: null
		},
		{
			label: 'GPT-3.5 Turbo',
			model: 'gpt-3.5-turbo-0125',
			apiKey: null,
			baseURL: null
		},
		{
			label: 'GPT-4',
			model: 'gpt-4-0125-preview',
			apiKey: null,
			baseURL: null
		},
		{
			label: 'LM Studio',
			model: '',
			baseURL: 'http://localhost:1234/v1',
			apiKey: ''
		}
	],
	selectedModel: 'Haiku',
	debug: false,
	localModelPath: undefined
}
