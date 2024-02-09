import { App, Notice } from 'obsidian'
import { DataviewApi, getAPI as getNativeDataviewAPI } from 'obsidian-dataview'

const canUseDataview = (app: App): boolean => {
	return !!app.plugins.getPlugin('dataview')
}

const getAPI = (app: App): DataviewApi => {
	if (!canUseDataview(app)) {
		new Notice('Dataview plugin is not installed')
	}

	return getNativeDataviewAPI(app)
}

export { DataviewApi, getAPI }
