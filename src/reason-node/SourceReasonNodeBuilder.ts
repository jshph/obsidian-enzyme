import { StrategyMetadata } from 'notebook/ReasonAgent'
import { BaseReasonNodeBuilder } from '.'
import { ReasonNodeSpec, ReasonNodeType } from '../types'
import dedent from 'dedent-js'

export type SourceReasonNodeSpec = ReasonNodeSpec & {
	strategy: StrategyMetadata
	sourcePreamble: string
}

export enum DQLStrategy {
	SingleEvergreenReferrer,
	AllEvergreenReferrers,
	LongContent,
	RecentMentions,
	Basic
}

// Handle higher level extraction where the strategy does its querying independently from the user
export const isHighLevelStrategy = (strategy: StrategyMetadata): boolean => {
	return [DQLStrategy.RecentMentions].includes(DQLStrategy[strategy.name])
}

export const DQLStrategyDescriptions = {
	SingleEvergreenReferrer:
		'Extract content snippets from a file that reference a specific evergreen note or tag.',
	AllEvergreenReferrers:
		'Extract all content snippets from a file that reference any evergreen note or tag that is the result of a DQL query',
	LongContent: 'Extract the last few paragraphs of a file.',
	RecentMentions:
		'Identify the top most recent tags and links, and extract the content surrounding their mentions.'
}

export class SourceReasonNodeBuilder extends BaseReasonNodeBuilder<SourceReasonNodeSpec> {
	type: ReasonNodeType = ReasonNodeType.Source
	endpoint: string = 'create-source-node'
	color: string = '4'

	renderBodyDataWithSpec(spec: ReasonNodeSpec, body: string): string {
		const sourceSpec = spec as SourceReasonNodeSpec

		return dedent(`
    \`\`\`dataview
    ${sourceSpec.strategy.dql}
    \`\`\`
    `)
	}
}
