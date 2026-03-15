/**
 * Custom Jest transformer that strips shebangs before passing to ts-jest.
 * Files with #!/usr/bin/env node (or similar) cause SyntaxError when
 * Jest tries to instrument them for coverage collection.
 */
const { TsJestTransformer } = require('ts-jest');

class ShebangTransformer extends TsJestTransformer {
    process(sourceText, sourcePath, options) {
        const stripped = sourceText.replace(/^#!.*\n/, '\n');
        return super.process(stripped, sourcePath, options);
    }

    processAsync(sourceText, sourcePath, options) {
        const stripped = sourceText.replace(/^#!.*\n/, '\n');
        return super.processAsync(stripped, sourcePath, options);
    }
}

module.exports = new ShebangTransformer();
