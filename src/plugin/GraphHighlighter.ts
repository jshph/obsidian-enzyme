import { App, TFile } from 'obsidian'

type GraphColor = {
  a: number
  rgb: number
}

type GraphNode = {
  id: string
  color?: GraphColor | null
}

type GraphRenderer = {
  nodeLookup?: Record<string, GraphNode>
  colors?: {
    fillHighlight?: GraphColor
  }
  changed?: () => void
}

type HighlightedNode = {
  node: GraphNode
  previousColor: GraphColor | null | undefined
}

const GRAPH_VIEW_TYPES = ['graph', 'localgraph'] as const
const DEFAULT_HIGHLIGHT_COLOR: GraphColor = { a: 1, rgb: 0xffd166 }

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
      for (const path of paths) {
        const node = lookup[path]
        if (!node) continue
        this.highlighted.push({ node, previousColor: node.color })
        node.color = color
      }
      renderer.changed?.()
    }
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
