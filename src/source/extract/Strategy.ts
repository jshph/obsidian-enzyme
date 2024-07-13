import { StrategyMetadata } from '../../notebook/ObsidianEnzymeAgent'

export enum DQLStrategy {
	SingleEvergreenReferrer = 'SingleEvergreenReferrer',
	AllEvergreenReferrers = 'AllEvergreenReferrers',
	LongContent = 'LongContent',
	RecentMentions = 'RecentMentions',
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
	AllEvergreenReferrers:
		'Extract all content snippets from a file that reference any evergreen note or tag that is the result of a DQL query',
	LongContent: 'Extract the last few paragraphs of a file.',
	RecentMentions:
		'Identify the top most recent tags and links, and extract the content surrounding their mentions.',
	Basic: 'Extract the entire contents of a file.'
}
