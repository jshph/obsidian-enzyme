import { ModelConfig } from '../notebook'

export interface EnzymeSettings {
	models: ModelConfig[]
	selectedModel: string
	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	localModelPath?: string

	evergreenFolders: string[]

	trimFolders: string[]
}

export const DEFAULT_SETTINGS: EnzymeSettings = {
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
			model:
				'TheBloke/Mistral-7B-Instruct-v0.2-GGUF/mistral-7b-instruct-v0.2.Q8_0.gguf',
			baseURL: 'http://localhost:1234/v1',
			apiKey: ''
		}
	],
	selectedModel: 'Haiku',
	debug: false,
	localModelPath: undefined,
	evergreenFolders: [],
	trimFolders: []
}
