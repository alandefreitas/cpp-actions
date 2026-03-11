import { main } from './index'
import { describePrettyErrors } from 'pretty-errors/test-helper'

test('setup-msvc', async () => {
    // Main function is exported
    expect(main).toBeDefined()
})

describePrettyErrors('msvc boom', 'Setup MSVC failed')
