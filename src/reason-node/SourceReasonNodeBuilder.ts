import { BaseReasonNodeBuilder } from '.'
import { ReasonNodeSpec, ReasonNodeType } from '../types'
import dedent from 'dedent-js'

export type SourceReasonNodeSpec = ReasonNodeSpec & {
	strategy: string
	evergreen: string
	dql?: string
}

export enum DQLStrategy {
	SingleEvergreenReferrer,
	AllEvergreenReferrers,
	LongContent,
	RecentMentions,
	Basic
}

export const DQLStrategyDescriptions = {
	SingleEvergreenReferrer: undefined,
	AllEvergreenReferrers: undefined,
	LongContent: undefined,
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
    ${sourceSpec.dql}
    \`\`\`
    `)
	}
}
