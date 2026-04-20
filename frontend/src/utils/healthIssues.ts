export interface HealthIssueLike {
    type?: string | null;
    title?: string | null;
    description?: string | null;
    fixable?: boolean | null;
}

const normalizeText = (value: unknown): string => String(value || '').trim().toLowerCase();
const normalizeTableName = (value: unknown): string =>
    normalizeText(value).replace(/^public\./, '');

export const isRLSHealthIssue = (issue: HealthIssueLike): boolean => {
    const title = normalizeText(issue.title);
    return title.includes('row level security') || title.includes('missing rls policies');
};

export const extractIssueTableName = (issue: HealthIssueLike): string | null => {
    const title = String(issue?.title || '').trim();
    if (!title) {
        return null;
    }

    const quoted = title.match(/table\s+`([^`]+)`/i);
    if (quoted?.[1]) {
        return quoted[1].trim();
    }

    const genericQuoted = title.match(/`([^`]+)`/);
    if (genericQuoted?.[1]) {
        return genericQuoted[1].trim();
    }

    return null;
};

export const findRLSIssueForTable = (
    issues: HealthIssueLike[] | null | undefined,
    tableName: string | null | undefined,
): HealthIssueLike | null => {
    if (!Array.isArray(issues) || !tableName) {
        return null;
    }

    const target = normalizeTableName(tableName);
    if (!target) {
        return null;
    }

    for (const issue of issues) {
        if (!isRLSHealthIssue(issue)) {
            continue;
        }

        const issueTable = extractIssueTableName(issue);
        if (issueTable && normalizeTableName(issueTable) === target) {
            return issue;
        }

        const title = normalizeText(issue?.title);
        if (title.includes(`\`${target}\``) || title.includes(`table ${target}`)) {
            return issue;
        }
    }

    return null;
};

export const supportsHealthAutoFix = (issue: HealthIssueLike): boolean => {
    const type = normalizeText(issue.type);
    const title = normalizeText(issue.title);

    if (type === 'security') {
        return isRLSHealthIssue(issue) ||
            title.includes('public list rules') ||
            title.includes('geographic access breach');
    }

    if (type === 'performance') {
        return title.includes('missing an index') || title.includes('sequential scans');
    }

    return false;
};

