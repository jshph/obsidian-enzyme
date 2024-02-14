import { App, Notice } from 'obsidian'
import { DataviewApi, getAPI as getNativeDataviewAPI } from 'obsidian-dataview'

// TODO this is temporary until Obsidian typedef is updated
interface AppWithPlugins extends App {
	plugins: {
		getPlugin(pluginId: string): any
	}
}

const canUseDataview = (app: AppWithPlugins): boolean => {
	const appWithPlugins = app as AppWithPlugins
	return !!appWithPlugins.plugins.getPlugin('dataview')
}
const getAPI = (app: App): DataviewApi => {
	if (!canUseDataview(app)) {
		new Notice('Dataview plugin is not installed')
	}

	return getNativeDataviewAPI(app)
}

export { DataviewApi, getAPI }
