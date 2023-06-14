# Description: Build all the javascript projects in the repository

cd setup-program || exit
npm i
npm run all
cd ..

cd setup-gcc || exit
npm i
npm run all
cd ..

cd setup-clang || exit
npm i
npm run all
cd ..

cd cpp-matrix || exit
npm i
npm run all
cd ..

python3 docs/parse_actions.py
