import { App, TFile } from 'obsidian'

type GraphColor = {
  a: number
  rgb: number
}

type GraphNode = {
  id: string
  x?: number
  y?: number
  color?: GraphColor | null
}

type GraphLinkEndpoint = GraphNode | string | { id?: string }

type GraphLink = {
  source?: GraphLinkEndpoint
  target?: GraphLinkEndpoint
  sourceNode?: GraphLinkEndpoint
  targetNode?: GraphLinkEndpoint
  from?: GraphLinkEndpoint
  to?: GraphLinkEndpoint
}

type GraphRenderer = {
  links?: GraphLink[]
  nodeLookup?: Record<string, GraphNode>
  width?: number
  height?: number
  containerEl?: HTMLElement
  colors?: {
    fillHighlight?: GraphColor
  }
  changed?: () => void
  queueRender?: () => void
  setPan?: (panX: number, panY: number) => void
  setScale?: (scale: number) => void
}

type HighlightedNode = {
  node: GraphNode
  previousColor: GraphColor | null | undefined
}

const GRAPH_VIEW_TYPES = ['graph', 'localgraph'] as const
const DEFAULT_HIGHLIGHT_COLOR: GraphColor = { a: 1, rgb: 0xffd166 }
const GRAPH_FOCUS_PADDING_PX = 96
const GRAPH_FOCUS_MIN_WORLD_SIZE = 260
const GRAPH_FOCUS_MIN_SCALE = 0.35
const GRAPH_FOCUS_MAX_SCALE = 2.75

export class GraphHighlighter {
  private app: App
  private highlighted: HighlightedNode[] = []

  constructor(app: App) {
    this.app = app
  }

  highlightVaultSearchResultLinks(content: string, sourcePath = ''): void {
    const paths = this.extractResolvedPaths(content, sourcePath)
    this.highlightPaths(paths)
  }

  clear(): void {
    if (this.highlighted.length === 0) return

    const renderers = this.getGraphRenderers()
    for (const { node, previousColor } of this.highlighted) {
      node.color = previousColor
    }
    this.highlighted = []
    for (const renderer of renderers) {
      renderer.changed?.()
    }
  }

  private highlightPaths(paths: string[]): void {
    this.clear()
    if (paths.length === 0) return

    const renderers = this.getGraphRenderers()
    for (const renderer of renderers) {
      const lookup = renderer.nodeLookup
      if (!lookup) continue

      const color = renderer.colors?.fillHighlight ?? DEFAULT_HIGHLIGHT_COLOR
      const matchedNodes: GraphNode[] = []
      for (const path of paths) {
        const node = lookup[path]
        if (!node) continue
        this.highlighted.push({ node, previousColor: node.color })
        node.color = color
        matchedNodes.push(node)
      }
      this.focusNeighborhood(renderer, matchedNodes)
      renderer.changed?.()
      renderer.queueRender?.()
    }
  }

  private focusNeighborhood(renderer: GraphRenderer, selectedNodes: GraphNode[]): void {
    if (selectedNodes.length === 0 || typeof renderer.setPan !== 'function' || typeof renderer.setScale !== 'function') {
      return
    }

    const neighborhood = this.collectNeighborhood(renderer, selectedNodes)
    const positionedNodes = [...neighborhood].filter(this.hasPosition)
    if (positionedNodes.length === 0) return

    const bounds = this.getBounds(positionedNodes)
    const width = renderer.width ?? renderer.containerEl?.clientWidth ?? 0
    const height = renderer.height ?? renderer.containerEl?.clientHeight ?? 0
    if (width <= GRAPH_FOCUS_PADDING_PX * 2 || height <= GRAPH_FOCUS_PADDING_PX * 2) return

    const pixelRatio = renderer.containerEl?.ownerDocument.defaultView?.devicePixelRatio ?? activeWindow.devicePixelRatio ?? 1
    const viewportWidth = width * pixelRatio
    const viewportHeight = height * pixelRatio
    const padding = GRAPH_FOCUS_PADDING_PX * pixelRatio

    const worldWidth = Math.max(bounds.maxX - bounds.minX, GRAPH_FOCUS_MIN_WORLD_SIZE)
    const worldHeight = Math.max(bounds.maxY - bounds.minY, GRAPH_FOCUS_MIN_WORLD_SIZE)
    const scale = Math.max(
      GRAPH_FOCUS_MIN_SCALE,
      Math.min(
        GRAPH_FOCUS_MAX_SCALE,
        Math.min(
          (viewportWidth - padding * 2) / worldWidth,
          (viewportHeight - padding * 2) / worldHeight,
        ),
      ),
    )

    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2

    renderer.setScale(scale)
    renderer.setPan(viewportWidth / 2 - centerX * scale, viewportHeight / 2 - centerY * scale)
  }

  private collectNeighborhood(renderer: GraphRenderer, selectedNodes: GraphNode[]): Set<GraphNode> {
    const lookup = renderer.nodeLookup ?? {}
    const selectedIds = new Set(selectedNodes.map(node => node.id))
    const neighborhood = new Set(selectedNodes)

    for (const link of renderer.links ?? []) {
      const sourceId = this.getEndpointId(link.source ?? link.sourceNode ?? link.from)
      const targetId = this.getEndpointId(link.target ?? link.targetNode ?? link.to)
      if (!sourceId || !targetId) continue

      if (selectedIds.has(sourceId)) {
        const target = lookup[targetId]
        if (target) neighborhood.add(target)
      }
      if (selectedIds.has(targetId)) {
        const source = lookup[sourceId]
        if (source) neighborhood.add(source)
      }
    }

    return neighborhood
  }

  private getEndpointId(endpoint: GraphLinkEndpoint | undefined): string | null {
    if (!endpoint) return null
    if (typeof endpoint === 'string') return endpoint
    return endpoint.id ?? null
  }

  private hasPosition(node: GraphNode): node is GraphNode & { x: number; y: number } {
    return Number.isFinite(node.x) && Number.isFinite(node.y)
  }

  private getBounds(nodes: Array<GraphNode & { x: number; y: number }>): {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const node of nodes) {
      minX = Math.min(minX, node.x)
      maxX = Math.max(maxX, node.x)
      minY = Math.min(minY, node.y)
      maxY = Math.max(maxY, node.y)
    }

    return { minX, maxX, minY, maxY }
  }

  private getGraphRenderers(): GraphRenderer[] {
    const renderers: GraphRenderer[] = []
    for (const type of GRAPH_VIEW_TYPES) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const renderer = (leaf.view as unknown as { renderer?: GraphRenderer }).renderer
        if (renderer && typeof renderer.changed === 'function') {
          renderers.push(renderer)
        }
      }
    }
    return renderers
  }

  private extractResolvedPaths(content: string, sourcePath: string): string[] {
    const paths = new Set<string>()
    const linkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
    let match: RegExpExecArray | null

    while ((match = linkPattern.exec(content)) !== null) {
      const linktext = match[1]?.trim()
      if (!linktext) continue

      const file = this.app.metadataCache.getFirstLinkpathDest(linktext, sourcePath)
      if (file instanceof TFile) {
        paths.add(file.path)
        continue
      }

      const directPath = linktext.endsWith('.md') ? linktext : `${linktext}.md`
      const directFile = this.app.vault.getAbstractFileByPath(directPath)
      if (directFile instanceof TFile) {
        paths.add(directFile.path)
      }
    }

    return [...paths]
  }
}
