import { BaseReasonNodeBuilder } from '../obsidian-reason-core'
import { ReasonNodeSpec, ReasonNodeType } from '../obsidian-reason-core'
import dedent from 'dedent-js'

export type SourceReasonNodeSpec = ReasonNodeSpec & {
  strategy: string
  evergreen: string
  dql?: string
}

export enum DQLStrategy {
  SingleEvergreenReferrer,
  AllEvergreenReferrers,
  LongContent
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
