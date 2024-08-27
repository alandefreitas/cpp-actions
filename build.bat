REM Description: Build all the javascript projects in the repository

setlocal enabledelayedexpansion

set projects_with_package=
set projects_with_action=

for /d %%d in (*) do (
    REM Ignore the docs directory
    if "%%d" == "docs" (
        continue
    )

    if exist "%%d\package.json" (
        set projects_with_package=!projects_with_package! %%d
    ) else if exist "%%d\action.yml" (
        set projects_with_action=!projects_with_action! %%d
    )
)

echo ==== Composite actions ====
for %%p in (%projects_with_action%) do (
    echo %%p
)

echo ==== Javascript projects ====
for %%p in (%projects_with_package%) do (
    cd %%p
    echo ==== Building %%p ====
    call npm install
    call npm run all
    cd ..
)

endlocal
