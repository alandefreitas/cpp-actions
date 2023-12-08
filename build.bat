REM Description: Build all the javascript projects in the repository

set projects=setup-program setup-cmake setup-gcc setup-clang setup-cpp cmake-workflow cpp-matrix

for %%p in (%projects%) do (
    cd %%p
    call npm install
    call npm run all
    cd ..
)

call python3 docs/parse_actions.py
