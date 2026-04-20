import React from 'react';

const WIDTH_CLASS = {
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-7xl',
    full: 'max-w-none',
} as const;

type ModuleScrollWidth = keyof typeof WIDTH_CLASS;

interface ModuleScrollContainerProps {
    children: React.ReactNode;
    width?: ModuleScrollWidth;
    className?: string;
    innerClassName?: string;
}

const ModuleScrollContainer: React.FC<ModuleScrollContainerProps> = ({
    children,
    width = '6xl',
    className = '',
    innerClassName = '',
}) => (
    <div
        data-module-scroll-root
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain custom-scrollbar ${className}`.trim()}
    >
        <div
            className={`mx-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 xl:px-10 xl:py-10 space-y-6 lg:space-y-8 ${WIDTH_CLASS[width]} ${innerClassName}`.trim()}
        >
            {children}
        </div>
    </div>
);

export default ModuleScrollContainer;


