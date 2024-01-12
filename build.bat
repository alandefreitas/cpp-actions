REM Description: Build all the javascript projects in the repository

set projects=package-install setup-program setup-cmake setup-gcc setup-clang setup-cpp cmake-workflow b2-workflow cpp-matrix

for %%p in (%projects%) do (
    cd %%p
    call npm install
    call npm run all
    cd ..
)

