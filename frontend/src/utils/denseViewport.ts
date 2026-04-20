import { useEffect, useState } from 'react';

export const DENSE_DESKTOP_MAX_WIDTH = 1366;
export const DENSE_DESKTOP_MAX_HEIGHT = 720;

export const isDenseDesktopViewport = (width: number, height: number): boolean => (
    width <= DENSE_DESKTOP_MAX_WIDTH || height <= DENSE_DESKTOP_MAX_HEIGHT
);

export const getDenseDesktopViewport = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    return isDenseDesktopViewport(window.innerWidth, window.innerHeight);
};

export const useDenseDesktopViewport = (): boolean => {
    const [isDenseViewport, setIsDenseViewport] = useState<boolean>(() => getDenseDesktopViewport());

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const updateViewport = () => {
            setIsDenseViewport(getDenseDesktopViewport());
        };

        updateViewport();
        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, []);

    return isDenseViewport;
};

