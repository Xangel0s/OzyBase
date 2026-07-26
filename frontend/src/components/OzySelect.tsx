import React, {
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type OzySelectTone = 'default' | 'accent' | 'danger';
type OzySelectDensity = 'default' | 'compact';

interface OzySelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    tone?: OzySelectTone;
    density?: OzySelectDensity;
    wrapperClassName?: string;
    selectClassName?: string;
}

interface SelectOption {
    disabled: boolean;
    label: string;
    value: string;
}

const toneClasses: Record<OzySelectTone, string> = {
    default: 'border-border bg-[linear-gradient(180deg,rgba(20,20,20,0.98),rgba(10,10,10,0.96))] text-zinc-200 hover:border-primary/20 focus-within:border-primary/45 focus-within:ring-4 focus-within:ring-primary/10',
    accent: 'border-primary/25 bg-[linear-gradient(180deg,rgba(38,38,8,0.92),rgba(12,12,12,0.98))] text-white hover:border-primary/40 focus-within:border-primary/55 focus-within:ring-4 focus-within:ring-primary/15',
    danger: 'border-red-500/25 bg-[linear-gradient(180deg,rgba(52,12,12,0.92),rgba(12,12,12,0.98))] text-red-50 hover:border-red-500/40 focus-within:border-red-500/55 focus-within:ring-4 focus-within:ring-red-500/10',
};

const menuToneClasses: Record<OzySelectTone, string> = {
    default: 'border-border bg-[#0b0b0b] text-zinc-200',
    accent: 'border-primary/25 bg-[#0f0f08] text-white',
    danger: 'border-red-500/25 bg-[#140909] text-red-50',
};

const optionActiveClasses: Record<OzySelectTone, string> = {
    default: 'bg-primary/12 text-white',
    accent: 'bg-primary/14 text-white',
    danger: 'bg-red-500/14 text-red-50',
};

const optionSelectedClasses: Record<OzySelectTone, string> = {
    default: 'border-primary/20 bg-primary/10 text-primary',
    accent: 'border-primary/25 bg-primary/12 text-primary',
    danger: 'border-red-500/20 bg-red-500/10 text-red-200',
};

const densityWrapperClasses: Record<OzySelectDensity, string> = {
    default: 'rounded-md shadow-lg',
    compact: 'rounded-md shadow-none',
};

const densityButtonClasses: Record<OzySelectDensity, string> = {
    default: 'h-9 pl-3 pr-8 text-[11px]',
    compact: 'h-7 pl-2.5 pr-7 text-[10px]',
};

const densityMenuClasses: Record<OzySelectDensity, string> = {
    default: 'rounded-lg',
    compact: 'rounded-md',
};

const densityOptionClasses: Record<OzySelectDensity, string> = {
    default: 'rounded-md px-2.5 py-1.5 text-[11px]',
    compact: 'rounded px-2 py-1 text-[10px]',
};

const srOnlyClassName = 'pointer-events-none absolute h-px w-px overflow-hidden opacity-0';

const parseOptionLabel = (children: React.ReactNode): string => {
    if (typeof children === 'string' || typeof children === 'number') {
        return String(children);
    }

    const flattened = React.Children.toArray(children)
        .map((child) => {
            if (typeof child === 'string' || typeof child === 'number') {
                return String(child);
            }
            return '';
        })
        .join(' ')
        .trim();

    return flattened || 'Option';
};

const getOptionsFromChildren = (children: React.ReactNode): SelectOption[] => (
    React.Children.toArray(children)
        .filter(React.isValidElement)
        .map((child) => {
            const element = child as React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>;
            const rawValue = element.props.value ?? element.props.children ?? '';
            return {
                value: String(rawValue),
                label: parseOptionLabel(element.props.children),
                disabled: Boolean(element.props.disabled),
            };
        })
);

const findEnabledIndex = (options: SelectOption[], startIndex: number, direction: 1 | -1): number => {
    if (options.length === 0) {
        return -1;
    }

    let index = startIndex;
    for (let tries = 0; tries < options.length; tries += 1) {
        index = (index + direction + options.length) % options.length;
        if (!options[index]?.disabled) {
            return index;
        }
    }

    return -1;
};

const OzySelect = React.forwardRef<HTMLSelectElement, OzySelectProps>(function OzySelect(
    {
        tone = 'default',
        density = 'default',
        wrapperClassName = '',
        selectClassName = '',
        children,
        disabled,
        value,
        defaultValue,
        onChange,
        name,
        id,
        required,
        ...props
    },
    ref,
) {
    const selectId = useId();
    const selectElementId = id || `ozy-select-${selectId}`;
    const listboxId = `${selectElementId}-listbox`;
    const options = useMemo(() => getOptionsFromChildren(children), [children]);
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(() => {
        const initialValue = defaultValue ?? options.find((option) => !option.disabled)?.value ?? '';
        return String(initialValue ?? '');
    });
    const currentValue = String((isControlled ? value : internalValue) ?? '');
    const selectedOption = options.find((option) => option.value === currentValue)
        || options.find((option) => !option.disabled)
        || null;
    const selectedIndex = selectedOption ? options.findIndex((option) => option.value === selectedOption.value) : -1;
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(selectedIndex);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
    const [menuReady, setMenuReady] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const hiddenSelectRef = useRef<HTMLSelectElement | null>(null);
    const listboxRef = useRef<HTMLDivElement | null>(null);
    const typeaheadRef = useRef('');
    const typeaheadTimerRef = useRef<number | null>(null);

    useImperativeHandle(ref, () => hiddenSelectRef.current as HTMLSelectElement, []);

    useEffect(() => {
        if (!isControlled) {
            return;
        }
        if (!options.some((option) => option.value === currentValue)) {
            setInternalValue(options.find((option) => !option.disabled)?.value ?? '');
        }
    }, [currentValue, isControlled, options]);

    useEffect(() => {
        if (isControlled || options.length === 0) {
            return;
        }
        if (!options.some((option) => option.value === internalValue)) {
            setInternalValue(options.find((option) => !option.disabled)?.value ?? '');
        }
    }, [internalValue, isControlled, options]);

    useEffect(() => {
        if (!isOpen) {
            setMenuReady(false);
            return;
        }

        const updateMenuPosition = () => {
            if (!buttonRef.current) {
                return;
            }
            const rect = buttonRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const preferredHeight = density === 'compact'
                ? Math.min(240, Math.max(120, viewportHeight * 0.3))
                : Math.min(320, Math.max(180, viewportHeight * 0.42));
            const spaceBelow = viewportHeight - rect.bottom - 16;
            const openAbove = spaceBelow < 200 && rect.top > spaceBelow;
            const top = openAbove
                ? Math.max(12, rect.top - preferredHeight - 10)
                : Math.min(viewportHeight - preferredHeight - 12, rect.bottom + 10);

            const calculatedMinWidth = density === 'compact' ? Math.max(rect.width, 90) : Math.max(rect.width, 130);
            setMenuStyle({
                left: rect.left,
                top,
                width: calculatedMinWidth,
                maxHeight: preferredHeight,
            });
            setMenuReady(true);
        };

        const handlePointer = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (buttonRef.current?.contains(target) || listboxRef.current?.contains(target)) {
                return;
            }
            setIsOpen(false);
        };

        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);
        document.addEventListener('mousedown', handlePointer);

        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
            document.removeEventListener('mousedown', handlePointer);
        };
    }, [density, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const nextIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);
        setActiveIndex(nextIndex);
    }, [isOpen, selectedIndex, options]);

    useEffect(() => {
        if (!isOpen || activeIndex < 0 || !listboxRef.current) {
            return;
        }
        const node = listboxRef.current.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
        node?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, isOpen]);

    useEffect(() => () => {
        if (typeaheadTimerRef.current) {
            window.clearTimeout(typeaheadTimerRef.current);
        }
    }, []);

    const emitChange = (nextValue: string) => {
        if (hiddenSelectRef.current) {
            hiddenSelectRef.current.value = nextValue;
        }
        if (!isControlled) {
            setInternalValue(nextValue);
        }
        if (onChange && hiddenSelectRef.current) {
            onChange({
                target: hiddenSelectRef.current,
                currentTarget: hiddenSelectRef.current,
            } as React.ChangeEvent<HTMLSelectElement>);
        }
    };

    const handleNativeSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const nextValue = String(event.target.value ?? '');
        if (!isControlled) {
            setInternalValue(nextValue);
        }
        onChange?.(event);
    };

    const selectIndex = (index: number) => {
        const option = options[index];
        if (!option || option.disabled) {
            return;
        }
        emitChange(option.value);
        setIsOpen(false);
        buttonRef.current?.focus();
    };

    const openMenu = () => {
        if (disabled || options.length === 0) {
            return;
        }
        setIsOpen(true);
    };

    const handleClosedKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) {
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu();
            if (event.key === 'ArrowDown' && activeIndex >= 0) {
                const nextIndex = findEnabledIndex(options, activeIndex, 1);
                if (nextIndex >= 0) {
                    setActiveIndex(nextIndex);
                }
            }
            if (event.key === 'ArrowUp' && activeIndex >= 0) {
                const previousIndex = findEnabledIndex(options, activeIndex, -1);
                if (previousIndex >= 0) {
                    setActiveIndex(previousIndex);
                }
            }
            return;
        }

        if (event.key.length === 1 && /\S/.test(event.key)) {
            const letter = event.key.toLowerCase();
            const matchIndex = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(letter));
            if (matchIndex >= 0) {
                emitChange(options[matchIndex].value);
            }
        }
    };

    const handleOpenKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!isOpen) {
            handleClosedKeyDown(event);
            return;
        }

        switch (event.key) {
        case 'ArrowDown': {
            event.preventDefault();
            const nextIndex = findEnabledIndex(options, activeIndex >= 0 ? activeIndex : selectedIndex, 1);
            if (nextIndex >= 0) {
                setActiveIndex(nextIndex);
            }
            break;
        }
        case 'ArrowUp': {
            event.preventDefault();
            const previousIndex = findEnabledIndex(options, activeIndex >= 0 ? activeIndex : selectedIndex, -1);
            if (previousIndex >= 0) {
                setActiveIndex(previousIndex);
            }
            break;
        }
        case 'Enter':
        case ' ': {
            event.preventDefault();
            if (activeIndex >= 0) {
                selectIndex(activeIndex);
            }
            break;
        }
        case 'Escape':
            event.preventDefault();
            setIsOpen(false);
            buttonRef.current?.focus();
            break;
        case 'Tab':
            setIsOpen(false);
            break;
        default:
            if (event.key.length === 1 && /\S/.test(event.key)) {
                const nextQuery = `${typeaheadRef.current}${event.key.toLowerCase()}`;
                typeaheadRef.current = nextQuery;
                if (typeaheadTimerRef.current) {
                    window.clearTimeout(typeaheadTimerRef.current);
                }
                typeaheadTimerRef.current = window.setTimeout(() => {
                    typeaheadRef.current = '';
                }, 500);

                const matchIndex = options.findIndex((option) => (
                    !option.disabled && option.label.toLowerCase().startsWith(nextQuery)
                ));
                if (matchIndex >= 0) {
                    setActiveIndex(matchIndex);
                }
            }
            break;
        }
    };

    return (
        <div className={`group relative border transition-all ${toneClasses[tone]} ${densityWrapperClasses[density]} ${disabled ? 'opacity-60' : ''} ${wrapperClassName}`}>
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-linear-to-r from-transparent via-white/12 to-transparent" />
            <select
                {...props}
                id={selectElementId}
                name={name}
                ref={hiddenSelectRef}
                disabled={disabled}
                required={required}
                value={selectedOption?.value ?? ''}
                onChange={handleNativeSelectChange}
                className={srOnlyClassName}
                tabIndex={-1}
                aria-hidden="true"
            >
                {children}
            </select>
            <button
                ref={buttonRef}
                type="button"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={isOpen ? listboxId : undefined}
                onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
                onKeyDown={handleOpenKeyDown}
                className={`flex w-full items-center justify-between gap-3 bg-transparent text-left font-medium text-inherit outline-none disabled:cursor-not-allowed ${densityButtonClasses[density]} ${selectClassName}`}
            >
                <span className={`block min-w-0 truncate ${selectedOption ? '' : 'text-zinc-600'}`}>
                    {selectedOption?.label || 'Select an option'}
                </span>
            </button>
            <ChevronDown
                size={15}
                className={`pointer-events-none absolute ${density === 'compact' ? 'right-3' : 'right-4'} top-1/2 -translate-y-1/2 transition-all ${disabled ? 'text-zinc-700' : 'text-zinc-500 group-focus-within:text-primary group-hover:text-zinc-200'} ${isOpen ? 'rotate-180' : ''}`}
            />
            {isOpen && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-240" />
                    <div
                        id={listboxId}
                        ref={listboxRef}
                        role="listbox"
                        aria-labelledby={selectElementId}
                        className={`fixed z-250 overflow-hidden border shadow-[0_30px_80px_-36px_rgba(0,0,0,0.95)] backdrop-blur-xl ${menuToneClasses[tone]} ${densityMenuClasses[density]} ${menuReady ? 'opacity-100' : 'opacity-0'}`}
                        style={menuStyle}
                    >
                        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-linear-to-r from-transparent via-white/10 to-transparent" />
                        <div className="max-h-[inherit] overflow-y-auto p-2 custom-scrollbar">
                            {options.map((option, index) => {
                                const isSelected = option.value === selectedOption?.value;
                                const isActive = index === activeIndex;
                                return (
                                    <button
                                        key={`${option.value}-${index}`}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        data-option-index={index}
                                        disabled={option.disabled}
                                        onMouseEnter={() => setActiveIndex(index)}
                                        onClick={() => selectIndex(index)}
                                        className={`mb-1 flex w-full items-center gap-3 border text-left font-medium transition-all last:mb-0 ${densityOptionClasses[density]} ${
                                            option.disabled
                                                ? 'cursor-not-allowed border-transparent text-zinc-700 opacity-60'
                                                : isSelected
                                                    ? optionSelectedClasses[tone]
                                                    : isActive
                                                        ? optionActiveClasses[tone]
                                                        : 'border-transparent text-zinc-300 hover:border-white/5 hover:bg-white/4 hover:text-white'
                                        }`}
                                    >
                                        <span className="whitespace-nowrap flex-1 text-xs font-semibold">{option.label}</span>
                                        {isSelected ? <Check size={14} className="shrink-0" /> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>,
                document.body,
            )}
        </div>
    );
});

export default OzySelect;


