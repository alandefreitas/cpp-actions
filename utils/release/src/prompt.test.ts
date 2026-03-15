import { askYesNo, askInput, askChoice, askConsent } from './prompt';
import * as readline from 'readline';

jest.mock('readline');

const mockQuestion = jest.fn();
const mockClose = jest.fn();
const mockCreateInterface = readline.createInterface as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockCreateInterface.mockReturnValue({
        question: mockQuestion,
        close: mockClose
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    (console.log as jest.Mock).mockRestore();
});

/**
 * Helper to simulate readline question callback with the given answer.
 * @param answer - The simulated user input
 */
function simulateAnswer(answer: string): void {
    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
        cb(answer);
    });
}

describe('askYesNo', () => {
    it('should return true when user answers "y"', async () => {
        simulateAnswer('y');
        const result = await askYesNo('Continue?');
        expect(result).toBe(true);
        expect(mockClose).toHaveBeenCalled();
    });

    it('should return true when user answers "yes"', async () => {
        simulateAnswer('yes');
        const result = await askYesNo('Continue?');
        expect(result).toBe(true);
    });

    it('should return true when user answers "YES" (case insensitive)', async () => {
        simulateAnswer('YES');
        const result = await askYesNo('Continue?');
        expect(result).toBe(true);
    });

    it('should return false when user answers "n"', async () => {
        simulateAnswer('n');
        const result = await askYesNo('Continue?');
        expect(result).toBe(false);
    });

    it('should return false when user answers anything other than y/yes', async () => {
        simulateAnswer('maybe');
        const result = await askYesNo('Continue?');
        expect(result).toBe(false);
    });

    it('should return false (default) on empty input when defaultYes is false', async () => {
        simulateAnswer('');
        const result = await askYesNo('Continue?', false);
        expect(result).toBe(false);
    });

    it('should return true (default) on empty input when defaultYes is true', async () => {
        simulateAnswer('');
        const result = await askYesNo('Continue?', true);
        expect(result).toBe(true);
    });

    it('should display [Y/n] hint when defaultYes is true', async () => {
        simulateAnswer('');
        await askYesNo('Continue?', true);
        expect(mockQuestion).toHaveBeenCalledWith(
            expect.stringContaining('[Y/n]'),
            expect.any(Function)
        );
    });

    it('should display [y/N] hint when defaultYes is false', async () => {
        simulateAnswer('');
        await askYesNo('Continue?', false);
        expect(mockQuestion).toHaveBeenCalledWith(
            expect.stringContaining('[y/N]'),
            expect.any(Function)
        );
    });

    it('should trim whitespace from answer', async () => {
        simulateAnswer('  y  ');
        const result = await askYesNo('Continue?');
        expect(result).toBe(true);
    });
});

describe('askInput', () => {
    it('should return user input', async () => {
        simulateAnswer('hello');
        const result = await askInput('Enter value');
        expect(result).toBe('hello');
        expect(mockClose).toHaveBeenCalled();
    });

    it('should return default value on empty input', async () => {
        simulateAnswer('');
        const result = await askInput('Enter value', 'default-val');
        expect(result).toBe('default-val');
    });

    it('should return empty string when no input and no default', async () => {
        simulateAnswer('');
        const result = await askInput('Enter value');
        expect(result).toBe('');
    });

    it('should display default value in prompt when provided', async () => {
        simulateAnswer('');
        await askInput('Enter value', 'mydefault');
        expect(mockQuestion).toHaveBeenCalledWith(
            'Enter value [mydefault]: ',
            expect.any(Function)
        );
    });

    it('should not display default in prompt when not provided', async () => {
        simulateAnswer('test');
        await askInput('Enter value');
        expect(mockQuestion).toHaveBeenCalledWith(
            'Enter value: ',
            expect.any(Function)
        );
    });

    it('should trim whitespace from input', async () => {
        simulateAnswer('  trimmed  ');
        const result = await askInput('Enter value');
        expect(result).toBe('trimmed');
    });
});

describe('askChoice', () => {
    const options = [
        { label: 'Option A', description: 'First option' },
        { label: 'Option B' },
        { label: 'Option C', description: 'Third option' }
    ];

    it('should return selected option (0-based) when user picks a valid number', async () => {
        simulateAnswer('2');
        const result = await askChoice('Pick one:', options);
        expect(result).toBe(1);
        expect(mockClose).toHaveBeenCalled();
    });

    it('should return first option when user picks 1', async () => {
        simulateAnswer('1');
        const result = await askChoice('Pick one:', options);
        expect(result).toBe(0);
    });

    it('should return default (0-based) on empty input', async () => {
        simulateAnswer('');
        const result = await askChoice('Pick one:', options, 2);
        expect(result).toBe(1); // defaultIndex 2 → 0-based 1
    });

    it('should use default index 1 when not specified', async () => {
        simulateAnswer('');
        const result = await askChoice('Pick one:', options);
        expect(result).toBe(0); // defaultIndex 1 → 0-based 0
    });

    it('should return default on invalid (NaN) selection', async () => {
        simulateAnswer('abc');
        const result = await askChoice('Pick one:', options, 1);
        expect(result).toBe(0);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Invalid selection'));
    });

    it('should return default when selection is out of range (too low)', async () => {
        simulateAnswer('0');
        const result = await askChoice('Pick one:', options, 2);
        expect(result).toBe(1);
    });

    it('should return default when selection is out of range (too high)', async () => {
        simulateAnswer('10');
        const result = await askChoice('Pick one:', options, 2);
        expect(result).toBe(1);
    });

    it('should display options with descriptions', async () => {
        simulateAnswer('1');
        await askChoice('Pick one:', options);
        expect(console.log).toHaveBeenCalledWith('Pick one:');
        expect(console.log).toHaveBeenCalledWith('  1) Option A - First option');
        expect(console.log).toHaveBeenCalledWith('  2) Option B');
        expect(console.log).toHaveBeenCalledWith('  3) Option C - Third option');
    });
});

describe('askConsent', () => {
    it('should return false in dry run mode without prompting', async () => {
        const result = await askConsent('do something', 'cmd', false, true);
        expect(result).toBe(false);
        expect(console.log).toHaveBeenCalledWith('[DRY RUN] Skipping execution');
        expect(mockQuestion).not.toHaveBeenCalled();
    });

    it('should return true with skipPrompt flag without prompting user', async () => {
        const result = await askConsent('do something', 'cmd', true, false);
        expect(result).toBe(true);
        expect(console.log).toHaveBeenCalledWith('Proceeding (--yes flag)');
        expect(mockQuestion).not.toHaveBeenCalled();
    });

    it('should display description and command', async () => {
        simulateAnswer('y');
        await askConsent('run tests', 'npm test', false, false);
        expect(console.log).toHaveBeenCalledWith('\nAbout to: run tests');
        expect(console.log).toHaveBeenCalledWith('Command: npm test');
    });

    it('should prompt user when neither skipPrompt nor dryRun', async () => {
        simulateAnswer('y');
        const result = await askConsent('do something', 'cmd', false, false);
        expect(result).toBe(true);
        expect(mockQuestion).toHaveBeenCalled();
    });

    it('should return false when user declines', async () => {
        simulateAnswer('n');
        const result = await askConsent('do something', 'cmd', false, false);
        expect(result).toBe(false);
    });

    it('should pass defaultYes to askYesNo', async () => {
        simulateAnswer('');
        const result = await askConsent('do something', 'cmd', false, false, true);
        expect(result).toBe(true);
    });

    it('should check dryRun before skipPrompt', async () => {
        const result = await askConsent('do something', 'cmd', true, true);
        expect(result).toBe(false);
        expect(console.log).toHaveBeenCalledWith('[DRY RUN] Skipping execution');
    });
});
