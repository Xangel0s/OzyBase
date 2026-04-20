import { fetchWithAuth } from './api';
import { dispatchProjectSync } from './projectEvents';

export interface HealthFixIssue {
    id?: number;
    type?: string | null;
    title?: string | null;
    fixable?: boolean;
}

export interface RLSCoverageFixItem {
    table_name: string;
    rls_db_enabled: boolean;
    missing_actions: string[];
    fully_covered?: boolean;
}

const readFixErrorMessage = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
};

export const canAutoFixCoverageItem = (
    item: RLSCoverageFixItem | null | undefined,
): item is RLSCoverageFixItem => Boolean(item && !item.fully_covered && item.table_name);

export const buildCoverageIssueTitle = (item: RLSCoverageFixItem): string => {
    if (!item.rls_db_enabled) {
        return `Table \`${item.table_name}\` does not have Row Level Security enabled`;
    }
    return `Table \`${item.table_name}\` is missing RLS policies for: ${item.missing_actions.join(', ')}`;
};

export const buildCoverageHealthFixIssue = (item: RLSCoverageFixItem): HealthFixIssue => ({
    type: 'security',
    title: buildCoverageIssueTitle(item),
    fixable: true,
});

export const formatHealthFixSuccessMessage = (issue: HealthFixIssue): string => (
    `Applied fix for: ${issue.title ?? 'selected issue'}`
);

export const applyHealthFix = async (
    issue: HealthFixIssue,
    fallbackMessage = 'Failed to apply fix',
): Promise<void> => {
    const response = await fetchWithAuth('/api/project/health/fix', {
        method: 'POST',
        body: JSON.stringify({
            type: issue.type,
            issue: issue.title,
        }),
    });

    if (!response.ok) {
        throw new Error(await readFixErrorMessage(response, fallbackMessage));
    }

    dispatchProjectSync({
        tables: true,
        health: true,
        coverage: true,
        reason: 'health-fix-applied',
    });
};

