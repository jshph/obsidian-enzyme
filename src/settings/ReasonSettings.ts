import { ModelConfig } from '../notebook'

export interface ReasonSettings {
	models: { [key: string]: ModelConfig }
	selectedModel: string
	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	reasonLicenseKey: string

	localModelPath?: string
}

export const DEFAULT_SETTINGS: ReasonSettings = {
	models: {
		'GPT-3.5 Turbo': {
			model: 'gpt-3.5-turbo-1106',
			apiKey: null,
			baseURL: null
		}
	},
	selectedModel: 'GPT-3.5 Turbo',
	debug: false,
	reasonLicenseKey: '',
	localModelPath: undefined
}
