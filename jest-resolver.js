/**
 * Custom Jest resolver for ESM-only packages.
 *
 * Handles @actions/* v3+ packages that only export under the "import" condition
 * by adding that condition to the resolver when standard resolution fails.
 */
module.exports = (request, options) => {
    // For @actions/* packages, add 'import' condition proactively
    if (request.startsWith('@actions/')) {
        return options.defaultResolver(request, {
            ...options,
            conditions: [...(options.conditions || []), 'import']
        });
    }
    return options.defaultResolver(request, options);
};
