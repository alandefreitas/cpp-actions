REM Description: Build all the javascript projects in the repository

cd setup-program
call npm install
call npm run all
cd ..

cd setup-cmake
call npm install
call npm run all
cd ..

cd setup-gcc
call npm install
call npm run all
cd ..

cd setup-clang
call npm install
call npm run all
cd ..

cd setup-cpp
call npm install
call npm run all
cd ..

cd cpp-matrix
call npm install
call npm run all
cd ..

call python3 docs/parse_actions.py
