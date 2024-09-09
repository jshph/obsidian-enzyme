import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Editor, EditorPosition } from 'obsidian';
import { createPopper } from '@popperjs/core';
import ReactDOM from 'react-dom';

interface RefinePopupProps {
  onSubmit: (prompt: string, format: string, cursorPos: EditorPosition) => void;
  anchorElement: HTMLDivElement | null;
}

type RefinePopupRef = {
	show: (getPosition: () => { left: number; top: number }) => void;
	hide: () => void;
  setInsertPosition: (cursorPos: EditorPosition) => void;
}

const RefinePopup = forwardRef<RefinePopupRef, RefinePopupProps>(({ onSubmit, anchorElement }, ref) => {
	const [isVisible, setIsVisible] = useState(false);
	const [format, setFormat] = useState('🔎 Focus');
	const [inputValue, setInputValue] = useState('');
	const [isInputExpanded, setIsInputExpanded] = useState(false);
	const refinePopupEl = useRef<HTMLDivElement | null>(null);
	const tooltipContainer = useRef<HTMLDivElement | null>(null);
	const [cursorPos, setCursorPos] = useState<EditorPosition | null>(null);
  
  const formats = [
		{ value: '🔎 Focus', tooltip: 'Refine and expand on the selected content' },
		{ value: '🪶 Style', tooltip: 'Rewrite the selected content with a style that matches the prompt' }
	];



	useEffect(() => {
		if (isVisible && refinePopupEl.current && anchorElement) {
			createPopper(anchorElement, refinePopupEl.current, {
				placement: 'top-start',
				modifiers: [{ name: 'offset', options: { offset: [0, 10] } }],
			});
		}
	}, [isVisible]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (refinePopupEl.current && !refinePopupEl.current.contains(event.target as Node)) {
				hide();
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				hide();
			} else if (event.key === 'Enter') {
				handlePromptSubmit();
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				hide();
			}
		};

		// Attach event listeners to the popup element
		if (refinePopupEl.current) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleEscape);
			refinePopupEl.current.addEventListener('keydown', handleKeyDown);
		}

		return () => {
			if (refinePopupEl.current) {
				refinePopupEl.current.removeEventListener('click', handleClickOutside);
				refinePopupEl.current.removeEventListener('keydown', handleKeyDown);
				document.removeEventListener('keydown', handleEscape);
				document.removeEventListener('keydown', handleKeyDown);
			}
		};
	}, [isVisible, refinePopupEl]);

	const setInsertPosition = (cursorPos: EditorPosition) => {
		setCursorPos(cursorPos);
	};

	const hide = () => {
		setIsVisible(false);
		setInputValue('');
		setIsInputExpanded(false);
	};

  useImperativeHandle(ref, () => ({
    show: (getPosition: () => { left: number; top: number }) => {
      reveal(getPosition);
    },
    hide: () => {
      hide();
    },
    setInsertPosition: setInsertPosition
  }));

	const handlePromptSubmit = () => {
    if (cursorPos) {
      onSubmit(inputValue, format, cursorPos);
    }
  };

	const expandInput = () => {
		setIsInputExpanded(true);
	};

	const collapseInput = () => {
		if (!inputValue) {
			setIsInputExpanded(false);
		}
	};

	useEffect(() => {
		const handleMouseOver = (e: MouseEvent) => {
			const selectedFormat = (e.target as HTMLSelectElement).value;
			const selectedTooltip = formats.find(f => f.value === selectedFormat)?.tooltip;
			if (tooltipContainer.current) {
				tooltipContainer.current.textContent = selectedTooltip || '';
				tooltipContainer.current.style.display = 'block';
				const rect = (e.target as HTMLElement).getBoundingClientRect();
				tooltipContainer.current.style.top = `${rect.top - tooltipContainer.current.offsetHeight - 10}px`;
				tooltipContainer.current.style.left = `${rect.left}px`;
			}
		};

		const handleMouseOut = () => {
			if (tooltipContainer.current) {
				tooltipContainer.current.style.display = 'none';
			}
		};

		const formatSelectElement = document.querySelector('.enzyme-prompt-format-select');
		if (formatSelectElement) {
			formatSelectElement.addEventListener('mouseover', handleMouseOver);
			formatSelectElement.addEventListener('mouseout', handleMouseOut);
		}

		return () => {
			if (formatSelectElement) {
				formatSelectElement.removeEventListener('mouseover', handleMouseOver);
				formatSelectElement.removeEventListener('mouseout', handleMouseOut);
			}
		};
	}, [refinePopupEl]);

	const reveal = (getPosition: () => { left: number; top: number }) => {
		setIsVisible(true);

		// Position the popup near the cursor
		const { left, top } = getPosition();
		if (anchorElement) {
			anchorElement.style.left = `${left}px`;
			anchorElement.style.top = `${top}px`;
		}
	};

	return (
		<>
			<div ref={tooltipContainer} className="enzyme-prompt-tooltip-container"></div>
			<div 
				ref={refinePopupEl} 
				className={`enzyme-prompt-popup ${isVisible ? 'visible' : 'hidden'}`}
				tabIndex={0}
			>
				<div className="enzyme-prompt-popup-content">
					<div className={`enzyme-prompt-input-container ${isInputExpanded ? 'expanded' : ''}`}>
						<select className="enzyme-prompt-format-select" value={format} onChange={(e) => setFormat(e.target.value)}>
							<option value="🔎 Focus">🔎 Focus</option>
							<option value="🪶 Style">🪶 Style</option>
						</select>
						<input
							type="text"
							placeholder={isInputExpanded ? 'Enter your refinement prompt...' : 'Refine'}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onFocus={expandInput}
							onBlur={collapseInput}
						/>
						<button onClick={handlePromptSubmit}>→</button>
					</div>
				</div>
			</div>
		</>
	);
});


export const renderRefinePopup = (onSubmit: (prompt: string, format: string, cursorPos: EditorPosition) => void) => {
  const anchorElement = document.body.createDiv();
  anchorElement.classList.add('enzyme-refine-popup');
  
  const ref = React.createRef<RefinePopupRef>();

  ReactDOM.render(<RefinePopup anchorElement={anchorElement} onSubmit={onSubmit} ref={ref} />, anchorElement);

  return {
    show: (getPosition: () => { left: number; top: number }) => {
      ref.current?.show(getPosition);
    },
    hide: () => {
      ref.current?.hide();
    },
    setInsertPosition: (cursorPos: EditorPosition) => {
      ref.current?.setInsertPosition(cursorPos);
    }
  };
};

export default RefinePopup;