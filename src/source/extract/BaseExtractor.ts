import {
  BlockCache,
  CachedMetadata,
  TFile,
  parseLinktext,
  ReferenceCache,
  App
} from 'obsidian'
import * as _path from 'path'
import { BlockRefSubstitution } from '../../obsidian-reason-core/src/types'

export type ParsedContent = {
  title: string
  path: string
  mtime: number
  referenceWindows: string[]
  // promptContext?: string
}

export type PreparedContents = {
  contents: string
  metadata: CachedMetadata
}

export type FileContents = {
  file: string
  last_modified_date: string
  contents: string
  substitutions: BlockRefSubstitution[]
}

export abstract class BaseExtractor {
  app: App
  abstract extract(
    file: TFile,
    metadata: CachedMetadata,
    strategy: string,
    evergreen?: string
  ): Promise<any>

  substituteBlockReferences(
    title: string,
    contents: string
  ): { substitutions: BlockRefSubstitution[]; contents: string } {
    // Replace any reference strings (^blockid) with block reference (![[file#^blockid]])
    const blockRefRegex = /\^([a-zA-Z0-9]+)/g
    const blockRefs = contents.match(blockRefRegex)
    let substitutions: BlockRefSubstitution[] = []
    if (blockRefs) {
      for (const blockRef of blockRefs) {
        const blockRefString = `![[${title}#${blockRef}]]`
        const templateString = `%${Math.random().toString(16).slice(2, 6)}%`
        substitutions.push({
          template: templateString,
          block_reference: blockRefString
        })
        contents = contents.replace(blockRef, templateString)
      }
    }

    // additional cleaning which helps disambiguate markers for the agent
    let cleanContents = contents.replace(/\[.*?\]\(.*?\)/g, '')

    return {
      substitutions: substitutions,
      contents: cleanContents
    }
  }

  cleanContents(contents: string): string {
    // Get what's after frontmatter
    const frontmatterRegex = /---\n(.*?)\n---/s
    const frontmatterMatch = contents.match(frontmatterRegex)
    if (frontmatterMatch) {
      contents = contents.substring(frontmatterMatch[0].length)
    }

    // Remove code blocks
    contents = contents.replace(/```[\s\S]*?```/g, '').trim()

    return contents
  }

  async getEmbedContent(reference: ReferenceCache) {
    try {
      const pathOfEmbed = parseLinktext(reference.link)
      const tfile: TFile = this.app.metadataCache.getFirstLinkpathDest(
        pathOfEmbed.path,
        '/'
      )

      if (!tfile.extension.includes('md')) {
        return ''
      }

      const metadata: CachedMetadata | null =
        this.app.metadataCache.getFileCache(tfile)

      var fullContent = await this.app.vault.cachedRead(tfile)

      if (pathOfEmbed.subpath && pathOfEmbed.subpath.startsWith('#^')) {
        const blockId: string = pathOfEmbed.subpath.substring(2)
        const block: BlockCache = metadata?.blocks[blockId]
        return fullContent.substring(
          block.position.start.offset,
          block.position.end.offset
        )
      } else {
        // Shouldn't happen... this function is passed an embed reference
        return ''
      }
    } catch (exception) {
      console.error(`Failed to get embed: ${exception.message}`)
      return ''
    }
  }

  async replaceEmbeds(
    contents: string,
    metadata: CachedMetadata
  ): Promise<string> {
    let newOffset = 0
    for (let embed of metadata?.embeds || []) {
      const referenceContent = await this.getEmbedContent(embed)
      contents =
        contents.slice(0, embed.position.start.offset + newOffset) +
        referenceContent +
        contents.slice(newOffset + embed.position.end.offset)
      newOffset += referenceContent.length - (embed.original?.length || 0)
    }

    return contents
  }
}
