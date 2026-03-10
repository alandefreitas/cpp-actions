import { main } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';

test('setup-gcc', async () => {
    // Main function is exported
    expect(main).toBeDefined();
});

describePrettyErrors('gcc boom', 'Setup GCC failed');
