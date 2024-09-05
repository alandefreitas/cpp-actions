const main = require('./index')
const gh_inputs = require('../common/gh-inputs')

test('parseExtraArgsEntry', async () => {
    // const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    // expect(semver.valid(pkg.version)).toBeTruthy()
    expect(gh_inputs.parseBashArguments(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master'])
})

