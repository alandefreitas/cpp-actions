jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn()
}));

import { Commit } from './types';
import { populateConventional, removeCommitDuplicates } from './git-parsing';

/**
 * Parses a commit message the way the action parses local commits.
 *
 * @param message - Full commit message
 * @returns The populated commit
 */
async function parse(message: string): Promise<Commit> {
    const commit = new Commit();
    commit.hash = 'abc1234000000000000000000000000000000000';
    commit.message = message;
    return populateConventional(commit, undefined, /^v\d+\.\d+\.\d+$/, []);
}

describe('populateConventional', () => {
    it('should keep the lines of a body paragraph', async () => {
        const commit = await parse('fix: subject\n\nline one\nline two\n');
        expect(commit.body).toBe('line one\nline two');
    });

    it('should keep a blank line between body paragraphs', async () => {
        const commit = await parse('fix: subject\n\nfirst\n\n  \nsecond\n');
        expect(commit.body).toBe('first\n\nsecond');
    });

    it('should not add a paragraph break before footers', async () => {
        const commit = await parse('fix: subject\n\nbody\n\nCloses #12\n');
        expect(commit.body).toBe('body');
        expect(commit.footers).toEqual({ 'Closes': '#12' });
    });
});

describe('removeCommitDuplicates', () => {
    it('should separate merged bodies with a paragraph break', async () => {
        const first = await parse('fix: subject\n\nfirst body\n');
        const second = await parse('fix: subject\n\nsecond body\n');
        const merged = removeCommitDuplicates([first, second]);
        expect(merged).toHaveLength(1);
        expect(merged[0].body).toBe('first body\n\nsecond body');
    });

    it('should take the body of a duplicate when the first has none', async () => {
        const first = await parse('fix: subject\n');
        const second = await parse('fix: subject\n\nsecond body\n');
        expect(removeCommitDuplicates([first, second])[0].body).toBe('second body');
    });
});
