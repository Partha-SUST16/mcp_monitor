// Zero-dependency line-level diff via Longest Common Subsequence.
// Used by Session Replay to compare two tool calls' arguments/responses so you
// can see exactly what changed between, say, two runs of the same tool — which
// surfaces nondeterminism, regressions, and flaky inputs that aggregate metrics hide.

export type DiffType = 'eq' | 'add' | 'del';
export interface DiffLine {
    type: DiffType;
    line: string;
}

/** Pretty-print any JSON-able value into an array of lines for diffing. */
export function prettyLines(value: unknown): string[] {
    let text: string;
    try {
        text = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        text = String(value);
    }
    return text.split('\n');
}

/**
 * Classic dynamic-programming LCS, then backtrack to emit a unified diff:
 * unchanged lines as 'eq', lines only in `a` as 'del', lines only in `b` as 'add'.
 */
export function lcsDiff(a: string[], b: string[]): DiffLine[] {
    const n = a.length;
    const m = b.length;
    // dp[i][j] = LCS length of a[i:] and b[j:]
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            out.push({ type: 'eq', line: a[i] });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: 'del', line: a[i] });
            i++;
        } else {
            out.push({ type: 'add', line: b[j] });
            j++;
        }
    }
    while (i < n) out.push({ type: 'del', line: a[i++] });
    while (j < m) out.push({ type: 'add', line: b[j++] });
    return out;
}
