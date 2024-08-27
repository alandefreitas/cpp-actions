## 🚀 Features

New features and additions

- cpp-matrix:
    - ✨ Older containers suggest volumes for node 20.[^1] () [e822cfb](https://github.com/alandefreitas/cpp_actions/commit/e822cfbf49390d4f890126846eb242867aa97e1b)
    - 💫 Is-container auxiliary key. () [e7ba3ed](https://github.com/alandefreitas/cpp_actions/commit/e7ba3ed7eca4045f6d75a5a713407ea5f5894d71)
    - 🌟 Force factor flags. () [90721bc](https://github.com/alandefreitas/cpp_actions/commit/90721bc4957bf658d0015e2eaa9b126191af0614)
- ✨ setup-clang: Support clang >=18. () [e6d4e1a](https://github.com/alandefreitas/cpp_actions/commit/e6d4e1ae2dec2c5942c5c1d2cf1d7e7ae463017e)

## 🐛 Fixes

Bug fixes and error corrections

- package-install: Output is kebab case. () [8ef6e75](https://github.com/alandefreitas/cpp_actions/commit/8ef6e75c1d4f2e25026ef50d0ae4fc655550e347)
- cpp-matrix:
    - Suggestions check for validRange. () [3507d04](https://github.com/alandefreitas/cpp_actions/commit/3507d049fa58363fd14aac8dfcf32732e54cc782)
    - Default macos is macos-14. () [d7448bc](https://github.com/alandefreitas/cpp_actions/commit/d7448bcca370d209bca8c7bd0629baf33d75362b)
    - Windows runner has MSVC 14.40.33810. () [08b53f3](https://github.com/alandefreitas/cpp_actions/commit/08b53f3786a4d2b8023c50151b445e2d021fa4c9)
- setup-clang: Verify LLVM repo Release files. () [616c184](https://github.com/alandefreitas/cpp_actions/commit/616c184a6d1055066e9d790c02f13aa2231c77b9)
- setup-gcc:
    - Ensure software-properties-common. () [dbfb999](https://github.com/alandefreitas/cpp_actions/commit/dbfb9991b272735a21d1c8626226222569cd720a)
    - GCC 14 comes from Ubuntu 24.04. () [b8048ca](https://github.com/alandefreitas/cpp_actions/commit/b8048ca24f569cd9101e26a8a64d7d0da631f196)

## ♻️ Refactor

Code refactoring and restructuring

- cpp-matrix:
    - Pkg-config included in container default installs. () [ccea92b](https://github.com/alandefreitas/cpp_actions/commit/ccea92b7493af62f1ed169f9e888c54b5113245b)
    - Extract support sanitizer as boolean. () [d8d941f](https://github.com/alandefreitas/cpp_actions/commit/d8d941fb2d8d1c6b4c9ffaabe5ec627254af9d3b)
- undefined: All actions use node20. () [afaaa06](https://github.com/alandefreitas/cpp_actions/commit/afaaa069fa97334891e7a5818359fbc8bb5166cc)
- package-install: Set DEBIAN_FRONTEND to noninteractive. () [c46917e](https://github.com/alandefreitas/cpp_actions/commit/c46917e66741c365169cbd54bfb5d337d44aac5d)

## 📖 Documentation

Documentation updates and improvements

- b2-workflow: Boost proposals in admonition. () [b316f3b](https://github.com/alandefreitas/cpp_actions/commit/b316f3bf59873908a7b9478d51bdb403caa0c2ea)
- cpp-matrix: Open ranges. () [236ccab](https://github.com/alandefreitas/cpp_actions/commit/236ccab6d0813d201e73737a37793ec10f7de484)

## 🎨 Style

Code style and formatting changes

- cpp-matrix: Print input parameters use JSON.stringify. () [4c4722b](https://github.com/alandefreitas/cpp_actions/commit/4c4722b38b4a6af43d0c47057059d6b05b75e95c)

## 🧪 Tests

Test cases and testing-related changes

- cpp-matrix: Custom suggestions. () [b73b6c8](https://github.com/alandefreitas/cpp_actions/commit/b73b6c8227935e26ee0ff7649b39f72a816cbf5e)

## 🚦 Continuous Integration

Changes related to continuous integration

- undefined:
    - Update actions/checkout to v4. () [b6f89ee](https://github.com/alandefreitas/cpp_actions/commit/b6f89ee1bf949f5e89fa28009c3c9c87a61d7a01)
    - Older containers patch node. () [76c0862](https://github.com/alandefreitas/cpp_actions/commit/76c0862a7d6bca9804b823806b7eb01f7b53b29c)
    - Matrix.cxx not required. () [fabf32b](https://github.com/alandefreitas/cpp_actions/commit/fabf32bd93d7604cb5e033c700e22bca1a96f6f9)
    - External actions updated. () [70d4c66](https://github.com/alandefreitas/cpp_actions/commit/70d4c66384beef7827cf751cebb4cb32ae3f9af2)
    - Only create releases for tags. () [56b1e44](https://github.com/alandefreitas/cpp_actions/commit/56b1e44b337e9322e529c3c9540f8d5b63489422)
- b2-workflow: Variant2 does not tests on windows. () [9ba6649](https://github.com/alandefreitas/cpp_actions/commit/9ba6649746d480195f73bb3872eaeede8a8c0d68)

> Parent release: [v1.8.2](https://github.com/alandefreitas/cpp_actions/releases/tag/v1.8.2) 080172d

[^1]: A recent update in GitHub actions deprecated older containers because the version of nodejs GitHub attempts to install is not compatible with them.The solution is to set up volumes where a custom version of Node can be installed.
