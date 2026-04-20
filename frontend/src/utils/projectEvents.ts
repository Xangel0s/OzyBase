export interface ProjectSyncDetail {
    tables?: boolean;
    health?: boolean;
    coverage?: boolean;
    reason?: string;
}

const PROJECT_SYNC_EVENT = 'ozy:project-sync';

export const dispatchProjectSync = (detail: ProjectSyncDetail): void => {
    if (typeof window === 'undefined') {
        return;
    }
    window.dispatchEvent(new CustomEvent<ProjectSyncDetail>(PROJECT_SYNC_EVENT, { detail }));
};

export const addProjectSyncListener = (
    listener: (detail: ProjectSyncDetail) => void,
): (() => void) => {
    if (typeof window === 'undefined') {
        return () => undefined;
    }

    const handleEvent = (event: Event) => {
        const customEvent = event as CustomEvent<ProjectSyncDetail>;
        listener(customEvent.detail || {});
    };

    window.addEventListener(PROJECT_SYNC_EVENT, handleEvent);
    return () => window.removeEventListener(PROJECT_SYNC_EVENT, handleEvent);
};

