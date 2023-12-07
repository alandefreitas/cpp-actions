# Description: Build all the javascript projects in the repository

cd setup-program || exit
npm install
npm run all
cd ..

cd setup-cmake || exit
npm install
npm run all
cd ..

cd setup-gcc || exit
npm install
npm run all
cd ..

cd setup-clang || exit
npm install
npm run all
cd ..

cd setup-cpp || exit
npm install
npm run all
cd ..

cd cpp-matrix || exit
npm install
npm run all
cd ..

python3 docs/parse_actions.py
