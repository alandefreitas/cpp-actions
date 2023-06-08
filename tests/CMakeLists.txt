#######################################################
### Project settings                                ###
#######################################################
cmake_minimum_required(VERSION 3.5)
project(cpp_actions)
project(cpp_actions
        VERSION 1.4.0
        LANGUAGES CXX)

#######################################################
### Dependencies                                    ###
#######################################################
if (NOT CPP_ACTIONS_NO_DEPS)
    find_package(fmt QUIET)
    if (NOT fmt_FOUND)
        include(FetchContent)
        FetchContent_Declare(
                fmt
                URL https://github.com/fmtlib/fmt/releases/download/10.0.0/fmt-10.0.0.zip
        )
        FetchContent_GetProperties(fmt)
        if (NOT fmt_POPULATED)
            FetchContent_Populate(fmt)
            set(FMT_SOURCE_ROOT ${fmt_SOURCE_DIR})
        endif ()
        add_subdirectory(${FMT_SOURCE_ROOT} EXCLUDE_FROM_ALL)
    endif ()

    find_package(Boost QUIET CONFIG)
    if (Boost_FOUND)
        add_library(Boost::variant2 ALIAS Boost::headers)
    else ()
        set(BOOST_SRC_DIR "boost-root" CACHE STRING "Boost source dir")
        set(BOOST_INCLUDE_LIBRARIES variant2)
        add_subdirectory(${BOOST_SRC_DIR} Dependencies/boost EXCLUDE_FROM_ALL)
    endif ()
endif ()

#######################################################
### Targets                                         ###
#######################################################
add_executable(test_executable main.cpp)
if (NOT CPP_ACTIONS_NO_DEPS)
    target_link_libraries(test_executable Boost::variant2 fmt::fmt)
else ()
    target_compile_definitions(test_executable PRIVATE CPP_ACTIONS_NO_DEPS)
endif()

#######################################################
### Tests                                           ###
#######################################################
if (BUILD_TESTING)
    include(CTest)
    add_test(test_executable test_executable)
endif ()

#######################################################
### Install                                         ###
#######################################################
include(CMakePackageConfigHelpers)
include(GNUInstallDirs)
install(TARGETS test_executable
        EXPORT test-targets
        LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
        ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
        RUNTIME DESTINATION bin
        )

#######################################################
### Package                                         ###
#######################################################
# https://cmake.org/cmake/help/latest/module/CPack.html
# Variables common to all CPack Generators
set(CPACK_PACKAGE_NAME ${PROJECT_NAME})
set(CPACK_PACKAGE_VENDOR ${PROJECT_NAME})
set(CPACK_PACKAGE_DIRECTORY ${CMAKE_BINARY_DIR}/packages)
set(CPACK_PACKAGE_VERSION_MAJOR ${CMAKE_PROJECT_VERSION_MAJOR})
set(CPACK_PACKAGE_VERSION_MINOR ${CMAKE_PROJECT_VERSION_MINOR})
set(CPACK_PACKAGE_VERSION_PATCH ${CMAKE_PROJECT_VERSION_PATCH})
set(CPACK_PACKAGE_DESCRIPTION ${CMAKE_PROJECT_DESCRIPTION})
set(CPACK_PACKAGE_DESCRIPTION_FILE ${CMAKE_CURRENT_SOURCE_DIR}/../README.adoc)
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY ${CMAKE_PROJECT_DESCRIPTION})
set(CPACK_PACKAGE_HOMEPAGE_URL http://www.github.com/alandefreitas/cpp-actions)
set(DEFAULT_FILENAME ${CPACK_PACKAGE_NAME}-${PROJECT_VERSION}-${CMAKE_SYSTEM_NAME})
string(TOLOWER ${DEFAULT_FILENAME} LC_DEFAULT_FILENAME)
set(CPACK_PACKAGE_FILE_NAME ${LC_DEFAULT_FILENAME})
string(TOLOWER ${PROJECT_NAME} LC_PROJECT_NAME)
set(CPACK_PACKAGE_INSTALL_DIRECTORY ${LC_PROJECT_NAME})
# CPACK_PACKAGE_ICON
# CPACK_PACKAGE_CHECKSUM
# CPACK_PROJECT_CONFIG_FILE
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/../LICENSE")
set(CPACK_RESOURCE_FILE_README "${CMAKE_CURRENT_SOURCE_DIR}/../README.adoc")
set(CPACK_RESOURCE_FILE_WELCOME "${CMAKE_CURRENT_SOURCE_DIR}/../README.adoc")
set(CPACK_PACKAGE_EXECUTABLES "test_executable" "C++ Actions - Test Executable")
# CPACK_STRIP_FILES
set(CPACK_THREADS 0)

# Variables for Source Package Generators
set(DEFAULT_FILENAME ${CPACK_PACKAGE_NAME}-${PROJECT_VERSION}-source)
string(TOLOWER ${DEFAULT_FILENAME} LC_DEFAULT_FILENAME)
set(CPACK_SOURCE_PACKAGE_FILE_NAME ${LC_DEFAULT_FILENAME})
# CPACK_SOURCE_STRIP_FILES
# CPACK_SOURCE_OUTPUT_CONFIG_FILE
# Set CPACK_SOURCE_IGNORE_FILES with files source packages shouldn't install
# We get these from .gitignore to avoid redundancy
FILE(READ "${CMAKE_CURRENT_SOURCE_DIR}/../.gitignore" GITIGNORE_CONTENTS)
STRING(REGEX REPLACE ";" "\\\\;" GITIGNORE_CONTENTS "${GITIGNORE_CONTENTS}")
STRING(REGEX REPLACE "\n" ";" GITIGNORE_CONTENTS "${GITIGNORE_CONTENTS}")
set(CPACK_SOURCE_IGNORE_FILES ${GITIGNORE_CONTENTS})



# Always include CPack at last
include(CPack)


