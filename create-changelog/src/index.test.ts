import * as main from './index';

beforeEach(() => {
    main.featureSubjectIcon.count = 0;
});

test('generateOutput avoids duplicating scope for multiline entries', () => {
    const commitA = new main.Commit();
    commitA.type = 'docs';
    commitA.scope = 'setup-cmake';
    commitA.description = 'Clarify behavior of check-latest.';
    commitA.hash = '0dae13a0000000000000000000000000000000000';

    const commitB = new main.Commit();
    commitB.type = 'docs';
    commitB.scope = 'setup-cmake';
    commitB.description = 'Enhance cmake path descriptions.';
    commitB.hash = '6370bd9000000000000000000000000000000000';

    const changes = {
        docs: {
            'setup-cmake': [commitA, commitB]
        }
    };
    const changeTypePriority = ['docs'];
    const args = {
        link_commits: false,
        thank_non_regular: false
    } as any;
    const authors = {};

    const output = main.generateOutput(changes, changeTypePriority, args, undefined, authors, null);

    expect(output).toContain('- setup-cmake:\n    - Clarify behavior of check-latest. 0dae13a');
    expect(output).toContain('    - Enhance cmake path descriptions. 6370bd9');
    expect(output).not.toContain('setup-cmake: Clarify behavior of check-latest.');
    expect(output).not.toContain('setup-cmake: Enhance cmake path descriptions.');
});

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>;
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                };
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message);
                        mockCore.setFailed(error.message);
                    },
                    __mockCore: mockCore
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors');

            runPromise = prettyErrors.reportAndSetFailed(new Error('changelog boom'), { title: 'Create changelog failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('changelog boom');
            });
        });

        await runPromise!;
    });
});
