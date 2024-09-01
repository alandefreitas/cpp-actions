const main = require('./index')
// const fs = require('fs')
// const semver = require('semver')

test('parseExtraArgsEntry', async () => {
    // const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    // expect(semver.valid(pkg.version)).toBeTruthy()
    expect(main.parseExtraArgsEntry(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master'])
})

