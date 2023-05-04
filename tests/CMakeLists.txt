#######################################################
### Project settings                                ###
#######################################################
cmake_minimum_required(VERSION 3.5)
project(cpp_actions)

#######################################################
### Dependencies                                    ###
#######################################################
find_package(fmt)
find_package(Boost QUIET CONFIG)
if (Boost_FOUND)
    add_library(Boost::variant2 ALIAS Boost::headers)
else ()
    set(BOOST_SRC_DIR "boost-root" CACHE STRING "Boost source dir")
    set(BOOST_INCLUDE_LIBRARIES variant2)
    add_subdirectory(${BOOST_SRC_DIR} Dependencies/boost EXCLUDE_FROM_ALL)
endif ()

#######################################################
### Targets                                         ###
#######################################################
add_executable(test_executable main.cpp)
target_link_libraries(test_executable Boost::variant2 fmt::fmt)

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