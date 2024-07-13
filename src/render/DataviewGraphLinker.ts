import { StrategyMetadata } from '../notebook/ObsidianEnzymeAgent'
import { App, Notice } from 'obsidian'
import { DataviewApi } from 'obsidian-dataview'
import { WorkspaceLeaf, View } from 'obsidian'
import { EnzymeSettings } from 'enzyme-core'

interface GraphLeaf extends WorkspaceLeaf {
	view: View & {
		dataEngine: {
			filterOptions: {
				search: {
					getValue: () => string
				}
			}
			setQuery: (query: any) => Promise<void>
		}
	}
}

export class DataviewGraphLinker {
	graphEngine: any
	paths: Set<string>
	public constructor(
		public app: App,
		public dataviewApi: DataviewApi,
		public settings: EnzymeSettings
	) {
		this.paths = new Set()
	}

	getGraph() {
		const graphLeaf = this.app.workspace.getLeavesOfType('graph')?.[0] as
			| GraphLeaf
			| undefined
		if (!graphLeaf) {
			new Notice('No graph view found. Please open the graph.')
		}
		return graphLeaf?.view.dataEngine
	}

	async addSources(sources: StrategyMetadata[]) {
		if (!this.settings.visualizeSourceInGraph) {
			return
		}
		let hasNewPaths = false
		await Promise.all(
			sources.map(async (source) => {
				let results
				let retries = 3
				while (retries > 0) {
					try {
						results = await this.dataviewApi.tryQuery(source.dql)
						break
					} catch (error) {
						retries--
						if (retries === 0) {
							throw error
						}
						await new Promise((resolve) => setTimeout(resolve, 200))
					}
				}
				const paths = results.values.map((path: any) => path.path)
				paths.forEach((path) => {
					if (!this.paths.has(path)) {
						this.paths.add(path)
						hasNewPaths = true
					}
				})
			})
		)

		if (hasNewPaths) {
			await this.refreshGraph()
		}
	}

	async removeSources(sources: StrategyMetadata[]) {
		if (!this.settings.visualizeSourceInGraph) {
			return
		}
		await Promise.all(
			sources.map(async (source) => {
				const results = await this.dataviewApi.tryQuery(source.dql)
				const paths = results.values.map((path: any) => path.path)
				this.paths = new Set(
					[...this.paths].filter((link) => !paths.includes(link))
				)
			})
		)
	}

	async refreshGraph() {
		if (this.paths.size === 0) {
			// Placeholder to not render the whole graph
			new Notice('No paths ')
			this.emptyGraph()
			return
		} else {
			// Render query from paths
			const query = Array.from(this.paths)
				.map((link) => `path:"${link}"`)
				.join(' OR ')

			const graph = this.getGraph()
			const existingQuery = graph.filterOptions.search.getValue()
			let finalQuery = query
			if (existingQuery.length) {
				finalQuery = `(${query}) AND (${existingQuery})`
			}

			await this.getGraph().setQuery([
				{
					query: finalQuery,
					color: undefined
				}
			])
		}
	}

	async emptyGraph() {
		await this.getGraph().setQuery([
			{
				query: 'file:@@@@!@&^#!^@#&^!@&#^!', // should be very rare
				color: undefined
			}
		])
	}

	async unlockGraph() {
		this.paths = new Set()
		await this.getGraph().setQuery([])
	}
}
