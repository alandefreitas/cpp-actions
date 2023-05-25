# This is a helper script that attempts to build all versions of GCC for GitHub actions.
# It attempts to create somewhat portable compilers that can be reused regardless of the
# linux container being used.
#
# Although this script attempts to build all versions of GCC, your platform is likely
# to be able to build only a range of versions. In most cases, you will need to set up
# docker containers to build some other ranges of compilers.
#
# In the actions, we always attempt to fetch GCC for those releases, as everything
# else is very unstable and relying on the few versions available from apt-get
# doesn't scale well. Nonetheless, workflows should prefer versions from apt-get
# as they are more representative of the versions users are likely to have installed.
#
# The releases created in this script use /opt/hostedtoolcache as the install directory
# to minimize conflicts when these binaries are used in github actions.
#
# Many versions will fail to build and that's fine. The intention of this script to
# build as many variants as possible in the host machine. In some cases, you need
# to run this script in more than one container to be able to get all versions.
#
# Another usual problem is that building GCC version X tends to fail when to
# compile with GCC version Y when Y is very distant from X or even
# slightly more recent than X.
#
# For this reason, the script has two modes of operation: a recursive mode and
# a "platform" GCC mode. When the recursive mode is "false", the script will use
# the default GCC version provided by build-essential to attempt to build
# all versions of GCC. The filename includes the ubuntu version used to build
# the binaries. The action will attempt to use these binaries when they are
# available.
#
# In "recursive mode", GCC versions are compiled from highest to lowest, so
# that the previously compiled GCC version is used to compile next/previous
# version. The libraries are also bundled with the installation and the
# filenames do not include the ubuntu version.
#
# If the complete process fails in "recursive mode", running it again might
# work for compilers that couldn't build in the first run. The reason is that
# the script also looks for the highest version of GCC that is still lower
# than the version being built. For instance, GCC 9.2 might fail compiling
# with GCC 9.4 because GCC 9.4 can find problems didn't exist when
# GCC 9.2 was released. But in a second run GCC 8.4 might be
# available, which would be preferred over GCC 9.4 and it's
# usually possible to build GCC 9.2 with GCC 8.4.
#
# In both modes, to maximize our success rate, we download and use the
# specified versions of the GCC dependencies instead of relying on the
# ones from the system.
#

if [ $EUID -eq 0 ]; then
  echo "This script should not be run as root or with sudo."
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "No argument provided: running script locally"
elif [ $# -eq 1 ]; then
  echo "Running script in docker container: $1"
  # This is not good to go...
  # Ideally, this would automatically run the script in a docker container
  # from the host, build everything and copy results back to the host.
  # The user of this script would only provide the container name as an argument.
  # In practice, we have a problem to access the container in detached
  # mode so that this only serves as reference of commands to run
  # the script in a container and copy the files back.
  #
  # The comments include the commands one needs to run from the guest and the host
  # to build everything in a container and copy the results back.
  exit
  # About images:
  # - ubuntu:22.04 can usually build GCC >= 9.3
  # - ubuntu:20.04 can usually build GCC >= 9.3
  # - ubuntu:18.04 can usually build GCC >=6.5 <= 9.2
  # - ubuntu:16.04 can usually build GCC >=4.7 < 7.1
  # - ubuntu:14.04 can usually build GCC >=4.5 < 5.5
  # image_name="ubuntu:22.04"
  image_name="$1"
  image_base_name=$(basename "${image_name}")
  timestamp=$(date +%s)
  # container_name="ubuntu-22.04-gcc"
  container_name="${image_base_name}_${timestamp}"
  container_name=${container_name//[^a-zA-Z0-9_.-]/_}            # Replace non-alphanumeric characters with underscores
  container_name=$(echo "$container_name" | sed 's/^_//;s/_$//') # Remove leading/trailing underscores
  # Set up container and user
  # docker run -it --name "$container_name" "$image_name"
  docker run -d --name "$container_name" "$image_name"
  docker start "$container_name" # This is where it fails in detached mode. Investigate this.
  docker ps
  # apt-get update
  # apt-get install -y sudo
  # apt-get install -y lsb-release
  docker exec -u 0 "$container_name" apt-get update
  docker exec -u 0 "$container_name" apt-get install -y sudo
  docker exec -u 0 "$container_name" apt-get install -y lsb-release
  # This step might fail in detached mode because the container won't be running,
  # so we might need to just log in and execute it ourselves.
  # $ docker exec -it "$container_name" bash
  # bash
  # USER=any_user_name # (this would reuse the host user name in the docker exec version)
  # useradd -m "$USER"
  docker exec useradd -m "$USER"
  # passwd "$USER"
  docker exec passwd "$USER"
  # usermod -aG sudo "$USER"
  docker exec usermod -aG sudo "$USER"
  # su "$USER"
  # cd "/home/$USER"
  # bash
  docker exec su "$USER"
  # Copy script to container (run from host)
  # docker cp "./build_all_gcc.sh" "$container_name:/home/$USER/"
  docker cp "$0" "$container_name:/home/$USER/"
  # Run script in container
  # bash ./build_all_gcc.sh
  docker exec -w "/home/$USER/" "$container_name" bash "./$0"
  # Check results (everything after this point from host)
  docker exec -w "/home/$USER/" "$container_name" ls
  # Copy tar.gz files from container back to host
  file_list=($(docker exec "$container_name" ls /home/$USER))
  for file in "${file_list[@]}"; do
    if [[ $file == *.tar.gz ]]; then
      if [ ! -e "$file" ]; then
        docker cp "$container_name:/home/$USER/$file" "$(pwd)"
      fi
    fi
  done
  # Copy GCC installations to this machine
  gcc_dir_list=($(docker exec "$container_name" ls /opt/hostedtoolcache/gcc))
  for gcc_dir in "${gcc_dir_list[@]}"; do
    if [[ ! -d "/opt/hostedtoolcache/gcc/$gcc_dir" ]]; then
      mkdir -p "./hostedtoolcache/gcc/$gcc_dir"
      docker cp "$container_name:/opt/hostedtoolcache/gcc/$gcc_dir" "./hostedtoolcache/gcc"
      mkdir -p "/opt/hostedtoolcache/gcc/$gcc_dir"
      mv "./hostedtoolcache/gcc/$gcc_dir" "/opt/hostedtoolcache/gcc"
    fi
  done
  # Remove container
  docker stop $container_name
  docker rm "$container_name"
else
  echo "Too many arguments"
  exit
fi

# Create toolcache dir emulating environment of the images
# We recreate the environment with hostedtoolcache, which is what
# GCC will use in GitHub actions. Anything hardcoded in the installation
# will refer to hostedtoolcache.
RUNNER_TOOL_CACHE="/opt/hostedtoolcache"
if [ ! -d "$RUNNER_TOOL_CACHE" ]; then
  echo "Please enter the root password to create the required $RUNNER_TOOL_CACHE directory:"
  sudo mkdir -p "$RUNNER_TOOL_CACHE"
  sudo chmod a+rwx /opt/hostedtoolcache
  sudo apt-get install -y build-essential git make curl flex
  sudo apt-get install -y gawk m4 bison flex texinfo libgmp-dev libmpfr-dev libmpc-dev zlib1g-dev libisl-dev
  echo "Running as a regular user again..."
fi

# Number of parallel jobs
N_JOBS="$(nproc)"
ARCH="$(uname -m)"

# Extract all GCC versions
git_tags=$(git ls-remote --tags git://gcc.gnu.org/git/gcc.git | awk '{print $2}' | cut -d '/' -f 3,4)
regex='^releases/gcc-([0-9]+(\.[0-9]+(\.[0-9]+)?)?)$'
versions=()
for tag in $git_tags; do
  if [[ $tag =~ $regex ]]; then
    # echo "$tag"
    version_str=${BASH_REMATCH[1]}
    versions+=("$version_str")
  fi
done

mapfile -t versions < <(printf '%s\n' "${versions[@]}" | sort -rV)
mapfile -t versionsUP < <(printf '%s\n' "${versions[@]}" | sort -V)

packaged_versions=()
failed_versions=()

echo "${versions[@]}"

# Use this variable to skip some versions for some reason
# Not that any expensive step is already skipped if the files are found
skip_versions=() # ubuntu 22.04
#skip_versions=("9.1.0" "9.2.0" "9.3.0" "9.4.0" "9.5.0" "10.1.0" "10.2.0" "10.3.0" "10.4.0" "11.1.0" "11.2.0" "11.3.0" "12.1.0" "12.2.0" "12.3.0" "13.1.0") # ubuntu 18.04
#skip_versions=("7.2.0" "7.3.0" "7.4.0" "7.5.0" "8.1.0" "8.2.0" "8.3.0" "8.4.0" "8.5.0" "9.1.0" "9.2.0" "9.3.0" "9.4.0" "9.5.0" "10.1.0" "10.2.0" "10.3.0" "10.4.0" "11.1.0" "11.2.0" "11.3.0" "12.1.0" "12.2.0" "12.3.0" "13.1.0") # ubuntu 16.04
#skip_versions=("4.6.4" "4.7.3" "4.7.4" "4.8.0" "4.8.1" "4.8.2" "4.8.3" "4.8.4" "4.8.5" "4.9.0" "4.9.1" "4.9.2" "4.9.3" "4.9.4" "5.3.0" "5.4.0" "5.5.0" "6.1.0" "6.2.0" "6.3.0" "6.4.0" "6.5.0" "7.1.0" "7.2.0" "7.3.0" "7.4.0" "7.5.0" "8.1.0" "8.2.0" "8.3.0" "8.4.0" "8.5.0" "9.1.0" "9.2.0" "9.3.0" "9.4.0" "9.5.0" "10.1.0" "10.2.0" "10.3.0" "10.4.0" "11.1.0" "11.2.0" "11.3.0" "12.1.0" "12.2.0" "12.3.0" "13.1.0")

# Disable warnings that tend to make it fail since there's no point in them.
# GCC releases are what they are.
CFLAGS="-fPIC -Wno-format-security -Wno-implicit-fallthrough -Wno-stringop-truncation -Wno-narrowing"
export CFLAGS
CXXFLAGS="$CFLAGS"
export CXXFLAGS
if [ "$CC" == "" ]; then
  CC=$(which gcc)
  export CC
  CXX=$(which g++)
  export CXX
fi
VERSION_OUTPUT=$("$CXX" --version)
regex='[0-9]+\.[0-9]+\.[0-9]+'
[[ $VERSION_OUTPUT =~ $regex ]]
CXX_VERSION="${BASH_REMATCH[0]}"

# Semver <
function semver_lt() {
  if [[ $(echo -e "$1\n$2" | sort -V | head -n1) == "$2" ]]; then
    return 1
  else
    return 0
  fi
}

function list_gcc_dependencies() {
  HOSTTOOLSCACHE_DEST="$1"
  version=$(basename "$HOSTTOOLSCACHE_DEST")
  libs=""
  for file in "$HOSTTOOLSCACHE_DEST/bin"/*; do
    if [ -f "$file" ] && [ -x "$file" ] && [ ! -d "$file" ] && [[ ! $(basename "$file") =~ \. ]]; then
      libs+="$(ldd "$file" | sed 's/ (.*)//g')\n"
    fi
  done
  for file in "$HOSTTOOLSCACHE_DEST/libexec/gcc/x86_64-unknown-linux-gnu/$version"/*; do
    if [ -f "$file" ] && [ -x "$file" ] && [ ! -d "$file" ] && [[ ! $(basename "$file") =~ \. ]]; then
      libs+="$(ldd "$file" | sed 's/ (.*)//g')\n"
    fi
  done
  for file in "$HOSTTOOLSCACHE_DEST/libexec/gcc/x86_64-pc-linux-gnu/$version"/*; do
    if [ -f "$file" ] && [ -x "$file" ] && [ ! -d "$file" ] && [[ ! $(basename "$file") =~ \. ]]; then
      libs+="$(ldd "$file" | sed 's/ (.*)//g')\n"
    fi
  done
  libs=$(echo -e "$libs" | sort -u)
  echo -e "$libs"
}

function test_gcc_with_cxx() {
  TEST_VERSION="$1"
  HOSTTOOLSCACHE_DEST="$RUNNER_TOOL_CACHE/gcc/$TEST_VERSION"
  filename=main.cpp
  echo -e "#include <iostream>\n\nint main() {\n    std::cout << \"Hello world from GCC $TEST_VERSION!\\\n\";\n    return 0;\n}\n" >"$filename"
  LD_LIBRARY_PATH_BEFORE="$LD_LIBRARY_PATH"
  LD_LIBRARY_PATH="/opt/hostedtoolcache/gcc/$TEST_VERSION/lib64/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-linux-gnu/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-unknown-gnu/$LD_LIBRARY_PATH"
  export LD_LIBRARY_PATH
  if semver_lt "$TEST_VERSION" "4.9.0"; then
    "$HOSTTOOLSCACHE_DEST/bin/g++" main.cpp -o main
  else
    "$HOSTTOOLSCACHE_DEST/bin/g++" main.cpp -o main -fsanitize=undefined
  fi
  compile_exit_status=$?
  if [ $compile_exit_status -ne 0 ]; then
    echo "Testing GCC $TEST_VERSION failed"
    list_gcc_dependencies "$HOSTTOOLSCACHE_DEST"
  else
    ./main
    run_exit_status=$?
  fi
  LD_LIBRARY_PATH="$LD_LIBRARY_PATH_BEFORE"
  export LD_LIBRARY_PATH
  if [ $compile_exit_status -ne 0 ] || [ $run_exit_status -ne 0 ]; then
    echo "Testing GCC $TEST_VERSION failed"
    return 1
  else
    echo "Testing GCC $TEST_VERSION succeeded"
    return 0
  fi
}

LD_LIBRARY_PATH_INIT="$LD_LIBRARY_PATH"

# Extract Ubuntu version: try some methods that might be available on containers
if [ "$ubuntu_version" == "" ]; then
  # Extract Ubuntu version from lsb_release -rs
  ubuntu_version=$(lsb_release -rs)
fi

if [ "$ubuntu_version" == "" ]; then
  # Extract Ubuntu version from /etc/os-release
  os_release=$(cat /etc/os-release)
  version_regex='VERSION_ID="([^"]+)"'
  if [[ $os_release =~ $version_regex ]]; then
    ubuntu_version=${BASH_REMATCH[1]}
  else
    ubuntu_version="Unknown"
  fi
fi

if [ "$ubuntu_version" == "" ]; then
  # Extract Ubuntu version from /etc/lsb-release
  lsb_release=$(cat /etc/lsb-release)
  version_regex='DISTRIB_RELEASE=([^ ]+)$'
  if [[ $lsb_release =~ $version_regex ]]; then
    ubuntu_version=${BASH_REMATCH[1]}
  fi
fi

if [ "$ubuntu_version" == "" ]; then
  # Extract Ubuntu version from uname -a
  uname_output=$(uname -a)
  version_regex='~([0-9]+\.[0-9]+)'
  if [[ $uname_output =~ $version_regex ]]; then
    ubuntu_version=${BASH_REMATCH[1]}
  fi
fi

if [ "$ubuntu_version" == "" ]; then
  echo "Please set and export \"ubuntu_version\""
  exit
fi

echo "Ubuntu Version: $ubuntu_version"

recursive_mode=false

set +e
for version_str in "${versions[@]}"; do
  echo "============= Process GCC $version_str"

  # Split version components
  IFS='.' read -ra components <<<"$version_str"
  major=${components[0]}
  if [ "${#components[@]}" -ge 2 ]; then
    minor=${components[1]}
  else
    minor=0
  fi
  if [ "${#components[@]}" -ge 3 ]; then
    patch=${components[2]}
  else
    patch=0
  fi
  release="$major.$minor.$patch"

  # Construct filename and directories to download GCC binaries
  gcc_basename="gcc-$release"
  gcc_dest="$RUNNER_TOOL_CACHE/gcc/$major.$minor.$patch"
  dist_dirname="$gcc_basename-$ARCH-linux-gnu-ubuntu-$ubuntu_version"
  binaries_filename="$dist_dirname.tar.gz"

  # Check skip list
  skip=false
  for skip_version in "${skip_versions[@]}"; do
    if [ "$skip_version" == "$release" ]; then
      echo "Specified version is in skip list"
      skip=true
      break
    fi
  done
  if [ "$skip" = "true" ]; then
    continue
  fi

  # Check if binaries already exist
  if [ -e "$binaries_filename" ] || [ -d "$gcc_dest" ]; then
    if [ -e "$binaries_filename" ]; then
      echo "Binaries $binaries_filename already exist"
    else
      echo "Installation $gcc_dest already exists"
    fi
    if [ -e "$gcc_dest/bin/gcc" ] || [ -e "$gcc_dest/bin/g++" ]; then
      packaged_versions+=("$release")
      if [ "$recursive_mode" == "true" ]; then
        if test_gcc_with_cxx "$release"; then
          CC="$gcc_dest/bin/gcc"
          export CC
          CXX="$gcc_dest/bin/g++"
          export CXX
          LD_LIBRARY_PATH="/opt/hostedtoolcache/gcc/$TEST_VERSION/lib64/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-linux-gnu/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-unknown-gnu/$LD_LIBRARY_PATH_INIT"
          export LD_LIBRARY_PATH
        fi
      fi
    else
      # Remove if empty
      rmdir "$gcc_dest"
    fi
    continue
  fi

  # Skip unsupported
  if [ "$ARCH" == "x86_64" ] && semver_lt "$release" "3.1.1"; then
    echo "$release does not support $ARCH"
    continue
  fi

  # Skip "impossible" to build
  # These are versions we can't build even with the oldest ubuntu images
  # Change the min version or uncomment this block to keep trying
  if semver_lt "$release" "4.7.3"; then
    echo "$release is impossible to build"
    continue
  fi

  echo "============= Find a compiler for GCC $version_str"

  # Find most appropriate compiler to build it (closest previous version)
  if [ "$recursive_mode" == "true" ]; then
    gcc_gcc_version=""
    for version_str_b in "${versionsUP[@]}"; do
      if semver_lt "$version_str_b" "$version_str" || [ "$gcc_gcc_version" = "" ]; then
        # version_str_b is lower or no version set yet
        gcc_dest_b="$RUNNER_TOOL_CACHE/gcc/$version_str_b"
        if [ -e "$gcc_dest_b/bin/g++" ]; then
          # and the compiler exists
          if test_gcc_with_cxx "$version_str_b"; then
            # and it works
            CC="$gcc_dest_b/bin/gcc"
            export CC
            CXX="$gcc_dest_b/bin/g++"
            export CXX
            CXX_VERSION="$version_str_b"
            gcc_gcc_version="$version_str_b"
          fi
        fi
      fi
    done
  fi

  echo "============= Building GCC $version_str with GCC $CXX_VERSION"

  # Download sources
  if [ ! -d "$gcc_basename" ]; then
    git clone git://gcc.gnu.org/git/gcc.git -b "releases/gcc-$version_str" "$gcc_basename" --depth 1
  fi
  cd "$gcc_basename" || exit

  if [ -d "__build__" ]; then
    rm -fr __build__
  fi

  # Download dependencies
  if [ -e "./contrib/download_prerequisites" ]; then
    ./contrib/download_prerequisites
  fi

  # Configure
  mkdir __build__
  cd __build__ || exit
  ./../configure --prefix="$gcc_dest" --disable-docs --disable-multilib --enable-languages="c,c++" --disable-werror MISSING=texinfo
  exit_code=$?
  if [[ $exit_code -ne 0 ]]; then
    failed_versions+=("$version_str")
    cd ../..
    continue
  fi

  if [ ! -d "$gcc_dest" ]; then
    # Build
    make -j "$N_JOBS" -s
    make_exit_code=$?
    if [ $make_exit_code -ne 0 ]; then
      echo "Error: Cannot build GCC $version_str"
      cd ../..
      continue
    fi

    # Install
    make install

    if [ ! -e "$gcc_dest/bin/g++" ]; then
      echo "Cannot find \"$gcc_dest/bin/g++\""
      rmdir "$gcc_dest"
      failed_versions+=("$version_str")
      cd ../..
      continue
    fi
  fi

  # Patch dependencies
  if [ "$recursive_mode" == "true" ]; then
    dependencies=$(list_gcc_dependencies "$gcc_dest")
    while IFS= read -r line; do
      dep_path=${line#*=> }
      dep_path=$(echo "$dep_path" | tr -d '[:space:]')
      if [[ -n "$line" ]] && [[ "$dep_path" != linux-vdso* ]]; then
        if [[ -e "$dep_path" ]]; then
          dep_dest="${gcc_dest%/}/${dep_path#/}"
          echo "Bundling $dep_path into $dep_dest"
          mkdir -p "$(dirname "$dep_dest")"
          cp -L "$dep_path" "$dep_dest"
        else
          echo "dependency $dep_path cannot be found"
        fi
      fi
    done <<<"$dependencies"
  fi

  # Create symlinks
  for file in "$gcc_dest/bin"/*; do
    if [ -h "$file" ]; then
      echo "$file is a symbolic link"
      continue
    fi
    if [ ! -x "$file" ]; then
      echo "$file is not executable"
      continue
    fi
    filename=$(basename "$file")
    echo "Create symlinks for $file"
    if [ ! -e "$gcc_dest/bin/$filename-$major" ]; then
      ln -sr "$gcc_dest/bin/$filename" "$gcc_dest/bin/$filename-$major"
    fi
    if [ ! -e "$gcc_dest/bin/$filename-$major.$minor" ]; then
      ln -sr "$gcc_dest/bin/$filename" "$gcc_dest/bin/$filename-$major.$minor"
    fi
    if [ ! -e "$gcc_dest/bin/$filename-$major.$minor.$patch" ]; then
      ln -sr "$gcc_dest/bin/$filename" "$gcc_dest/bin/$filename-$major.$minor.$patch"
    fi
  done

  # Package
  cd ../..
  if [ ! -e "$binaries_filename" ]; then
    # Temporarily rename dir so the tar.gz makes sense like others
    old_gcc_dest="$gcc_dest"
    new_gcc_dest="$(dirname "$gcc_dest")/$dist_dirname"
    echo mv "$old_gcc_dest" "$new_gcc_dest"
    mv "$old_gcc_dest" "$new_gcc_dest"
    echo tar -czf "$binaries_filename" -C "$(dirname "$gcc_dest")" "$dist_dirname"
    tar -czf "$binaries_filename" -C "$(dirname "$gcc_dest")" "$dist_dirname"
    echo mv "$new_gcc_dest" "$old_gcc_dest"
    mv "$new_gcc_dest" "$old_gcc_dest"
  fi

  if [ ! -e "$binaries_filename" ]; then
    echo tar -czvf "$binaries_filename" "$gcc_dest"
    tar -czvf "$binaries_filename" "$gcc_dest"
  fi
  packaged_versions+=("$release")

  # Print installed version
  "$gcc_dest/bin/g++" --version

  # Use this version of GCC to build the previous version of GCC
  # GCC cannot usually be built with a compiler that's much more recent than itself
  if [ "$recursive_mode" == "true" ]; then
    export CC="$gcc_dest/bin/gcc"
    export CXX="$gcc_dest/bin/g++"
    LD_LIBRARY_PATH="/opt/hostedtoolcache/gcc/$TEST_VERSION/lib64/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-linux-gnu/:/opt/hostedtoolcache/gcc/$TEST_VERSION/lib/x86_64-unknown-gnu/$LD_LIBRARY_PATH_INIT"
    export LD_LIBRARY_PATH
  fi
done

echo "============= Packaged GCC versions"
printf '%s\n' "${packaged_versions[@]}" | sort -rV

for packaged_version in "${packaged_versions[@]}"; do
  echo "============= Testing GCC $packaged_version"
  if ! test_gcc_with_cxx "$packaged_version"; then
    echo "At least one test failed for version $packaged_version"
  fi
done

if [ ${#failed_versions[@]} -gt 0 ]; then
  echo "============= Failed versions"
  printf '%s\n' "${failed_versions[@]}" | sort -rV
fi
