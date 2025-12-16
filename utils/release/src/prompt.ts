/**
 * User prompt utilities for interactive release workflow.
 */

import * as readline from 'readline';

/**
 * Creates a readline interface for user input.
 * @returns Readline interface
 */
function createReadline(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * Asks a yes/no question and returns the user's response.
 * @param question - The question to ask
 * @param defaultYes - Whether the default answer is yes (default: false)
 * @returns Promise resolving to true if user answered yes
 */
export function askYesNo(question: string, defaultYes = false): Promise<boolean> {
    return new Promise((resolve) => {
        const rl = createReadline();
        const hint = defaultYes ? '[Y/n]' : '[y/N]';

        rl.question(`${question} ${hint}: `, (answer) => {
            rl.close();
            const trimmed = answer.trim().toLowerCase();
            if (trimmed === '') {
                resolve(defaultYes);
            } else {
                resolve(trimmed === 'y' || trimmed === 'yes');
            }
        });
    });
}

/**
 * Asks for text input from the user.
 * @param prompt - The prompt to display
 * @param defaultValue - Optional default value
 * @returns Promise resolving to the user's input
 */
export function askInput(prompt: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createReadline();
        const displayPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `;

        rl.question(displayPrompt, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            resolve(trimmed || defaultValue || '');
        });
    });
}

/**
 * Asks the user to select from a list of options.
 * @param question - The question to ask
 * @param options - Array of options with labels
 * @param defaultIndex - The default option index (1-based)
 * @returns Promise resolving to the selected option index (0-based)
 */
export function askChoice(
    question: string,
    options: Array<{ label: string; description?: string }>,
    defaultIndex = 1
): Promise<number> {
    return new Promise((resolve) => {
        const rl = createReadline();

        console.log(question);
        options.forEach((opt, i) => {
            const desc = opt.description ? ` - ${opt.description}` : '';
            console.log(`  ${i + 1}) ${opt.label}${desc}`);
        });

        rl.question(`Selection [1-${options.length}, default ${defaultIndex}]: `, (answer) => {
            rl.close();
            const trimmed = answer.trim();
            if (trimmed === '') {
                resolve(defaultIndex - 1);
            } else {
                const num = parseInt(trimmed, 10);
                if (isNaN(num) || num < 1 || num > options.length) {
                    console.log(`Invalid selection. Using default: ${defaultIndex}`);
                    resolve(defaultIndex - 1);
                } else {
                    resolve(num - 1);
                }
            }
        });
    });
}

/**
 * Prompts for consent before running a command.
 * @param description - What the command does
 * @param command - The command that will be run
 * @param skipPrompt - Whether to skip the prompt
 * @param dryRun - Whether this is a dry run
 * @returns Promise resolving to true if user consents
 */
export async function askConsent(
    description: string,
    command: string,
    skipPrompt: boolean,
    dryRun: boolean
): Promise<boolean> {
    console.log(`\nAbout to: ${description}`);
    console.log(`Command: ${command}`);

    if (dryRun) {
        console.log('[DRY RUN] Skipping execution');
        return false;
    }

    if (skipPrompt) {
        console.log('Proceeding (--yes flag)');
        return true;
    }

    return askYesNo('Proceed?');
}
