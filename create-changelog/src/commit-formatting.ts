/**
 * Commit formatting utilities for create-changelog action.
 *
 * @module commit-formatting
 */

/**
 * Checks if a string is a valid conventional commit type.
 *
 * @param s - String to validate
 * @returns True if the string is a valid commit type
 */
export function isValidType(s: string): boolean {
    // A valid type according to `normalizeType`
    // Used to identify tags that can be converted to types
    const recognizedTypes = [
        'doc',
        'docs',
        'documentation',
        'fix',
        'fixes',
        'bugfix',
        'chore',
        'work',
        'chores',
        'maintenance',
        'feat',
        'feature',
        'refactor',
        'cleanup',
        'perf',
        'performance',
        'test',
        'testing',
        'tests',
        'release',
        'version',
        'ci',
        'integration',
        'breaking',
        'break',
        'revert',
        'undo',
        'style',
        'build',
        'improvement'
    ];
    return recognizedTypes.includes(s);
}

/**
 * Normalizes a commit type to a standard format.
 *
 * @param s - Type string to normalize
 * @returns Normalized type string
 */
export function normalizeType(s: string | null): string {
    if (!s) {
        return 'other';
    }

    // The units of information that make up Conventional Commits MUST NOT be treated as case sensitive
    // by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
    // BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE
    const categoryMapping: Record<string, string> = {
        'doc': 'docs',
        'documentation': 'docs',
        'fixes': 'fix',
        'bugfix': 'fix',
        'work': 'chore',
        'chores': 'chore',
        'maintenance': 'chore',
        'feature': 'feat',
        'cleanup': 'refactor',
        'performance': 'perf',
        'testing': 'test',
        'tests': 'test',
        'version': 'release',
        'integration': 'ci',
        'break': 'breaking',
        'undo': 'revert'
    };
    return categoryMapping[s.toLowerCase()] || s;
}

/**
 * Returns an emoji icon for a commit type.
 *
 * @param s - Commit type string
 * @returns Emoji icon representing the commit type
 */
export function iconFor(s: string | null): string {
    // https://github.com/favoloso/conventional-changelog-emoji#available-emojis
    const m: Record<string, string> = {
        'docs': '📖',
        'fix': '🐛',
        'style': '🎨',
        'chore': '🏗️',
        'build': '📦️',
        'feat': '🚀',
        'refactor': '♻️',
        'perf': '⚡️',
        'test': '🧪',
        'release': '🔖',
        'ci': '🚦',
        'improvement': '🛠️',
        'breaking': '🚨',
        'revert': '🔙',
        'other': '💬'
    };
    if (s === null) {
        return '💬';
    }
    return m.hasOwnProperty(s) ? m[s] : s;
}

/**
 * Converts a commit type to a human-readable section title.
 *
 * @param s - Commit type string
 * @returns Human-readable title for the commit type
 */
export function humanize(s: string): string {
    const mapping: Record<string, string> = {
        'docs': 'Documentation',
        'fix': 'Fixes',
        'style': 'Style',
        'chore': 'Chores',
        'build': 'Build',
        'feat': 'Features',
        'refactor': 'Refactor',
        'perf': 'Performance',
        'test': 'Tests',
        'release': 'Release',
        'ci': 'Continuous Integration',
        'improvement': 'Improvement',
        'breaking': 'Breaking',
        'revert': 'Revert',
        'other': 'Other'
    };
    return mapping[s] || s;
}

/**
 * Returns a description for a commit type.
 *
 * @param s - Commit type string
 * @returns Description of what this commit type represents
 */
export function commitTypeDescription(s: string): string {
    const mapping: Record<string, string> = {
        'docs': 'Documentation updates and improvements',
        'fix': 'Bug fixes and error corrections',
        'style': 'Code style and formatting changes',
        'chore': 'Routine tasks, maintenance, and housekeeping',
        'build': 'Build system and configuration changes',
        'feat': 'New features and additions',
        'refactor': 'Code refactoring and restructuring',
        'perf': 'Performance optimizations and enhancements',
        'test': 'Test cases and testing-related changes',
        'release': 'Release-specific changes and preparations',
        'ci': 'Changes related to continuous integration',
        'improvement': 'General improvements and enhancements',
        'breaking': 'Breaking changes and compatibility modifications',
        'revert': 'Reverted changes to previous versions',
        'other': 'Other changes not covered by specific categories'
    };
    return mapping[s] || '';
}

/**
 * Capitalizes the first letter of each sentence in a text.
 *
 * @param text - Text to capitalize
 * @returns Text with capitalized sentences
 */
export function capitalizeSentences(text: string): string {
    const sentences = text.split('. ');
    let result = '';
    for (let sentence of sentences) {
        sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
        sentence = sentence.trim();
        result += sentence;
        if (!sentence.endsWith('.')) {
            result += '. ';
        }
    }
    return result.trim();
}

/**
 * Returns a rotating icon for feature commits in the changelog.
 *
 * Cycles through sparkle/star icons (✨, 💫, 🌟) to add visual variety
 * when listing multiple feature commits in the generated changelog.
 *
 * @returns An emoji icon string that cycles through available feature icons
 */
export function featureSubjectIcon(): string {
    const icons = ['✨', '💫', '🌟'];
    const icon = icons[featureSubjectIcon.count % icons.length];
    featureSubjectIcon.count += 1;
    return icon;
}

// Initialize the count property
featureSubjectIcon.count = 0;
