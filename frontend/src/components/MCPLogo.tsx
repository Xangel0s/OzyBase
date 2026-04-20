import React from 'react';

interface MCPLogoProps {
    size?: number;
    className?: string;
}

const MCPLogo: React.FC<MCPLogoProps> = ({ size = 16, className = '' }) => {
    const strokeWidth = 1.8;
    const half = 12;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <path
                d="M6.5 4.8L12 2L17.5 4.8V11.2L12 14L6.5 11.2V4.8Z"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
            />
            <path
                d="M4 15.2L9.5 12.4L15 15.2V21.2L9.5 24L4 21.2V15.2Z"
                transform="translate(0 -2)"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                opacity="0.95"
            />
            <circle cx={half} cy="12" r="1.35" fill="currentColor" />
        </svg>
    );
};

export default MCPLogo;


