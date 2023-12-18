# Description: Build all the javascript projects in the repository

projects=("setup-program" "setup-cmake" "setup-gcc" "setup-clang" "setup-cpp" "cmake-workflow" "b2-workflow" "cpp-matrix")

for project in "${projects[@]}"; do
    cd "$project" || exit
    npm install
    npm run all
    cd ..
done

