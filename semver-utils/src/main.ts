import * as core from '@actions/core'
import { diff as semVerDiff, parse, satisfies as semVerSatisfies, SemVer } from 'semver'

function parts(version: SemVer, prefix: string): void {
  core.setOutput(`${prefix}release`, `${version.major}.${version.minor}.${version.patch}`)
  core.setOutput(`${prefix}major`, version.major)
  core.setOutput(`${prefix}minor`, version.minor)
  core.setOutput(`${prefix}patch`, version.patch)
}

function increments(versionInput: string): void {
  const identifierInput = core.getInput('identifier')
  let identifier = undefined

  if (identifierInput.trim() !== '') {
    identifier = identifierInput
  }

  core.setOutput('inc-major', parse(versionInput)?.inc('major', identifier).format())
  core.setOutput('inc-premajor', parse(versionInput)?.inc('premajor', identifier).format())
  core.setOutput('inc-minor', parse(versionInput)?.inc('minor', identifier).format())
  core.setOutput('inc-preminor', parse(versionInput)?.inc('preminor', identifier).format())
  core.setOutput('inc-patch', parse(versionInput)?.inc('patch', identifier).format())
  core.setOutput('inc-prepatch', parse(versionInput)?.inc('prepatch', identifier).format())
  core.setOutput('inc-prerelease', parse(versionInput)?.inc('prerelease', identifier).format())
}

function build(version: SemVer): void {
  if (version.build.length > 0) {
    core.setOutput('build', version.build.join('.'))
    core.setOutput('build-parts', version.build.length)

    version.build.forEach((buildPart, index) => {
      core.setOutput(`build-${index}`, buildPart)
    })
  }
}

function prerelease(version: SemVer): void {
  if (version.prerelease.length > 0) {
    core.setOutput('prerelease', version.prerelease.join('.'))
    core.setOutput('prerelease-parts', version.prerelease.length)

    version.prerelease.forEach((prereleasePart, index) => {
      core.setOutput(`prerelease-${index}`, prereleasePart)
    })
  }
}

function compare(version: SemVer): void {
  const compareToInput: string = core.getInput('compare-to')
  const compareTo = parse(compareToInput)

  if (compareTo != null) {
    switch (version.compare(compareTo)) {
      case -1:
        core.setOutput('comparison-result', '<')
        break
      case 0:
        core.setOutput('comparison-result', '=')
        break
      case 1:
        core.setOutput('comparison-result', '>')
        break
    }
  }
}

function diff(version: SemVer): void {
  const diffWithInput: string = core.getInput('diff-with')
  const compareToInput: string = core.getInput('compare-to')
  let diffTo: SemVer | null = null

  if (diffWithInput) {
    diffTo = parse(diffWithInput)
  } else if (compareToInput) {
    diffTo = parse(compareToInput)
  }

  if (diffTo) {
    core.setOutput('diff-result', semVerDiff(version, diffTo))
  }
}

function satisfies(version: SemVer, trace_commands: boolean): void {
  const satisfiesRangeInput: string = core.getInput('satisfies')

  if (satisfiesRangeInput) {
    core.setOutput('satisfies', semVerSatisfies(version, satisfiesRangeInput))
    if (trace_commands) {
      console.log(`Version ${version.version} satisfies the requirement ${satisfiesRangeInput}`)
    }
  } else {
    if (trace_commands) {
      console.log(`Version ${version.version} does NOT satisfy the requirement ${satisfiesRangeInput}`)
    }
  }
}

function run(): void {
  try {
    const lenient = core.getInput('lenient').toLowerCase() !== 'false'
    const versionInput = core.getInput('version', { required: true })
    const traceCommandsStr = core.getInput('trace-commands')
    const trace_commands: boolean = traceCommandsStr !== '' && traceCommandsStr.toLowerCase() !== 'false'
    const versions: (SemVer | null)[] = versionInput.split(/[\s,]+/).map(version => parse(version, { loose: true }))
    let version: SemVer | null = null
    let min_version: SemVer | null = null
    let max_version: SemVer | null = null
    if (versions.length === 1) {
      version = versions[0]
      min_version = versions[0]
      max_version = versions[0]
      if (trace_commands) {
        console.log(`Version provided: ${versionInput}`)
      }
    } else {
      if (trace_commands) {
        console.log(`${versions.length} versions provided in ${versionInput}`)
      }
      const satisfiesRangeInput: string = core.getInput('satisfies')
      min_version = null
      max_version = null
      for (const v of versions) {
        if (v && semVerSatisfies(v, satisfiesRangeInput)) {
          if (version == null) {
            version = v
          }
          if (max_version === null || v.compare(max_version) > 0) {
            max_version = v
          }
          if (min_version === null || v.compare(min_version) < 0) {
            min_version = v
          }
          break
        }
      }
      if (trace_commands) {
        console.log(`Min version in range is ${min_version}`)
        console.log(`Max version in range is ${max_version}`)
        console.log(`First version in range is ${max_version}`)
        if (version === null) {
          console.log(`Failed to find a version in ${versionInput} satisfying the requirements ${satisfiesRangeInput}`)
        }
      }
    }

    if (version === null || min_version === null || max_version === null) {
      if (!lenient) {
        core.setFailed(`Invalid version: ${versionInput}`)
      }
      return
    }

    parts(version, '')
    parts(min_version, 'min-')
    parts(max_version, 'max-')
    increments(versionInput)
    build(version)
    prerelease(version)
    compare(version)
    diff(version)
    satisfies(version, trace_commands)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
