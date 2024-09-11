import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import ReactDOM from 'react-dom';
import { App, MarkdownPostProcessorContext, MarkdownRenderer, Component, EditorPosition, Notice } from 'obsidian';
import { ObsidianEnzymeAgent, StrategyMetadata } from '../notebook/ObsidianEnzymeAgent';
import { DataviewCandidateRetriever } from '../source/retrieve';
import { DataviewGraphLinker } from './DataviewGraphLinker';

interface CodeBlockRendererProps {
  app: App;
  enzymeAgent: ObsidianEnzymeAgent;
  candidateRetriever: DataviewCandidateRetriever;
  dataviewGraphLinker: DataviewGraphLinker;
  getModels: () => string[];
  setModel: (label: string) => void;
  content: string;
  sources: StrategyMetadata[];
  context: MarkdownPostProcessorContext
}

type EnzymeBlockRef = {}

const EnzymeBlock = forwardRef<EnzymeBlockRef, CodeBlockRendererProps>((props, ref) => {
  const {
    app,
    enzymeAgent,
    candidateRetriever,
    dataviewGraphLinker,
    getModels,
    setModel,
    content,
    sources,
    context
  } = props;

  const [executionLock, setExecutionLock] = useState({ isExecuting: false });
  const [showSources, setShowSources] = useState(false);
  const [selectedModel, setSelectedModel] = useState(getModels()[0]);
  const contentRef = useRef<HTMLDivElement>(null);
  const sourcesContentRef = useRef<HTMLDivElement>(null);
  const sourcesButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!contentRef.current) {
      return
    }

    MarkdownRenderer.render(app, content, contentRef.current, '/', new Component());
  }, [content, sources]);

  const handleDigestButtonClick = async () => {
    if (!enzymeAgent.checkSetup()) {
      new Notice('Please check that Enzyme is set up properly (i.e. API Key, etc.)');
      return;
    }

    if (!executionLock.isExecuting) {
      try {
        setExecutionLock({ isExecuting: true });
        const digestStartPos = getDigestStartLine();
        await enzymeAgent.buildMessagesAndDigest({
          startPos: digestStartPos
        });
      } catch (e) {
        new Notice('Enzyme encountered an error: ' + e.message);
      } finally {
        setExecutionLock({ isExecuting: false });
      }
    } else {
      new Notice('Please wait for Enzyme to finish.');
    }
  };

  const getDigestStartLine = (): EditorPosition => {
    const editor = app.workspace.activeEditor?.editor;
    if (!editor || !contentRef.current) return { line: 0, ch: 0 };

    let endOfCodeFenceLine = context.getSectionInfo(contentRef.current)?.lineEnd ?? 0;
    let curLine = endOfCodeFenceLine + 1;

    while (curLine < editor.lineCount() && editor.getLine(curLine).trim() === '') {
      curLine++;
    }

    if (curLine >= editor.lineCount()) {
      curLine = endOfCodeFenceLine + 1;
    }

    while (
      curLine < editor.lineCount() &&
      (editor.getLine(curLine).includes('==') || editor.getLine(curLine).trim() === '')
    ) {
      let lineText = editor.getLine(curLine);
      if (lineText.includes('==')) {
        curLine++;
        while (curLine < editor.lineCount() && !editor.getLine(curLine).includes('==')) {
          curLine++;
        }
      }
      curLine++;
    }

    if (curLine >= editor.lineCount()) {
      curLine--;
    }

    return { line: curLine + 1, ch: 0 };
  };

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = event.target.value;
    setSelectedModel(newModel);
    setModel(newModel);
  };

  const handleSourcesButtonClick = () => {
    if (!sourcesContentRef.current) {
      return
    }
    sourcesContentRef.current.innerHTML = ''
    
    const rect = sourcesButtonRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    sourcesContentRef.current.style.top = `${rect.bottom + window.scrollY + 10}px`
    sourcesContentRef.current.style.left = `${rect.left + window.scrollX}px`
    sourcesContentRef.current.classList.toggle('show')

    Promise.all(sources.map(async (source) => {
      const sourceBlock =
        await candidateRetriever.obsidianContentRenderer.extractor.renderSourceBlock(
          source
        )
      
      const sourceEl = sourcesContentRef.current?.createEl('div', { cls: 'enzyme-source' })
      if (!sourceEl) {
        return
      }
      MarkdownRenderer.render(
        app,
        sourceBlock,
        sourceEl,
        '/',
        new Component()
      )
    }))
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sourcesContentRef.current && !sourcesContentRef.current.contains(event.target as Node)) {
        setShowSources(false);
        sourcesContentRef.current?.classList.remove('show')
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSources(false);
        sourcesContentRef.current?.classList.remove('show')
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    const sourcesContentEl = document.body.createEl('div', { cls: 'enzyme-sources-content' })
    sourcesContentRef.current = sourcesContentEl
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, []);

  return (
    <>
      <div ref={contentRef} className="enzyme-container">
        <button className="enzyme-digest-button" onClick={handleDigestButtonClick}>
          Digest
        </button>
        {sources.length > 0 && (
          <button ref={sourcesButtonRef} className="enzyme-sources-button" onClick={handleSourcesButtonClick}>
            Sources
          </button>
        )}
        <div className="enzyme-model-select-wrapper">
          <span className="enzyme-model-select-arrow">▼</span>
          <select
            className="enzyme-model-select"
            value={selectedModel}
            onChange={handleModelChange}
          >
            {getModels().map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>
    {/* <div ref={sourcesContentRef} className={`enzyme-sources-content ${showSources ? 'show' : ''}`}></div> */}
    </>
  );
});

export const renderCodeBlockRenderer = (containerEl: HTMLElement, props: CodeBlockRendererProps) => {
  const ref = React.createRef<EnzymeBlockRef>();

  ReactDOM.render(<EnzymeBlock {...props} ref={ref} />, containerEl);
};

export default EnzymeBlock;