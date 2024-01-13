import { BaseReasonNodeBuilder } from '../obsidian-reason-core'
import { ReasonNodeSpec, ReasonNodeType } from '../obsidian-reason-core'

type AggregatorReasonNodeSpec = ReasonNodeSpec & {
  schedule?: string
}

export class AggregatorReasonNodeBuilder extends BaseReasonNodeBuilder<AggregatorReasonNodeSpec> {
  endpoint: string = 'create-aggregator-node'
  type: ReasonNodeType = ReasonNodeType.Aggregator
  color: string = '5'

  renderBodyDataWithSpec(spec: ReasonNodeSpec, body: string): string {
    return spec.guidance.length > 0 ? spec.guidance : body
  }
}
