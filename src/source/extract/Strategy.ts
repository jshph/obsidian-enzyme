import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'

export enum DQLStrategy {
	SingleEvergreenReferrer = 'SingleEvergreenReferrer',
	RecentMentions = 'RecentMentions',
	Dynamic = 'Dynamic',
	Basic = 'Basic'
}

export const SELECTABLE_STRATEGIES = [DQLStrategy.RecentMentions]

// Handle higher level extraction where the strategy does its querying independently from the user
export const isHighLevelStrategy = (strategy: StrategyMetadata): boolean => {
	return [DQLStrategy.RecentMentions].includes(DQLStrategy[strategy.strategy])
}

export const DQLStrategyDescriptions = {
	SingleEvergreenReferrer:
		'Extract content snippets from a file that reference a specific evergreen note or tag.',
	LongContent: 'Extract the last few paragraphs of a file.',
	RecentMentions:
		'Identify the top most recent tags and links, and extract the content surrounding their mentions.',
	Basic: 'Extract the entire contents of a file.'
}
