# Time Trace

## Summary

| Step | %     | Total Time | Avg. | Count |
| --------- | ----- | ---------- | ------------ | ----- |
| Compile   | 100%   | 19.85 s | 9.92 s | 2 |
| 1) Frontend   | 94.43% | 18.74 s | 4.69 s | 4 |
| 1A) Parsing   | 91.48% | 18.16 s | 3.03 s | 6 |
| 1B) Instantiations   | 2.08% | 412.76 ms | 3.82 ms | 108 |
| 2) Backend   | 4.06% | 805.46 ms | 402.73 ms | 2 |
| 2A) Code Generation   | 3.59% | 712.55 ms | 356.28 ms | 2 |
| 2B) Optimization   | 0.44% | 86.95 ms | 43.47 ms | 2 |


## Files

### Compile

Total Time: 19.85 s

| File | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `test/unit/{boost_url_unit_tests}/authority_view.cpp` | 53.22% | 10.56 s | 10.56 s | 1 |
| `test/unit/{boost_url_unit_tests}/decode_view.cpp` | 46.78% | 9.29 s | 9.29 s | 1 |


### Parse

Total Time: 1.98 min

| File | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost/url/authority_view.hpp` | 7.35% | 8.75 s | 8.75 s | 1 |
| `boost/url/decode_view.hpp` | 7.09% | 8.44 s | 8.44 s | 1 |
| `boost/url/error_types.hpp` | 6.69% | 7.97 s | 3.98 s | 2 |
| `boost/system/error_code.hpp` | 5.78% | 6.88 s | 3.44 s | 2 |
| `boost/url/ipv4_address.hpp` | 5.3% | 6.31 s | 6.31 s | 1 |
| `boost/url/error.hpp` | 4.88% | 5.81 s | 5.81 s | 1 |
| `boost/system/detail/error_code.hpp` | 4.85% | 5.77 s | 2.89 s | 2 |
| `boost/system/detail/error_category.hpp` | 3.45% | 4.11 s | 2.05 s | 2 |


<details>
<summary>More...</summary>

| File | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost/url/authority_view.hpp` | 7.35% | 8.75 s | 8.75 s | 1 |
| `boost/url/decode_view.hpp` | 7.09% | 8.44 s | 8.44 s | 1 |
| `boost/url/error_types.hpp` | 6.69% | 7.97 s | 3.98 s | 2 |
| `boost/system/error_code.hpp` | 5.78% | 6.88 s | 3.44 s | 2 |
| `boost/url/ipv4_address.hpp` | 5.3% | 6.31 s | 6.31 s | 1 |
| `boost/url/error.hpp` | 4.88% | 5.81 s | 5.81 s | 1 |
| `boost/system/detail/error_code.hpp` | 4.85% | 5.77 s | 2.89 s | 2 |
| `boost/system/detail/error_category.hpp` | 3.45% | 4.11 s | 2.05 s | 2 |
| `boost/url/detail/config.hpp` | 3.37% | 4.01 s | 2.01 s | 2 |
| `boost/config.hpp` | 3.26% | 3.88 s | 1.94 s | 2 |
| `boost/core/detail/string_view.hpp` | 3.21% | 3.82 s | 1.91 s | 2 |
| `c++/13/string` | 3.08% | 3.67 s | 1.83 s | 2 |
| `boost/url/pct_string_view.hpp` | 2.39% | 2.84 s | 1.42 s | 2 |
| `boost/config/stdlib/libstdcpp3.hpp` | 2.3% | 2.74 s | 1.37 s | 2 |
| `boost/assert.hpp` | 1.9% | 2.26 s | 2.26 s | 1 |
| `c++/13/bits/basic_string.h` | 0.93% | 1.1 s | 550.89 ms | 2 |
| `boost/system/detail/error_condition.hpp` | 0.87% | 1.04 s | 518.11 ms | 2 |
| `boost/system/error_category.hpp` | 0.84% | 995.05 ms | 497.52 ms | 2 |
| `boost/system/detail/error_category_impl.hpp` | 0.83% | 988.26 ms | 494.13 ms | 2 |
| `boost/system/detail/mutex.hpp` | 0.81% | 963.27 ms | 481.63 ms | 2 |
| `c++/13/bits/memory_resource.h` | 0.8% | 956.67 ms | 478.33 ms | 2 |
| `c++/13/ios` | 0.76% | 905.02 ms | 452.51 ms | 2 |
| `c++/13/ext/string_conversions.h` | 0.76% | 900.08 ms | 450.04 ms | 2 |
| `c++/13/functional` | 0.72% | 859.92 ms | 429.96 ms | 2 |
| `test_rule.hpp` | 0.69% | 824.39 ms | 824.39 ms | 1 |
| `c++/13/mutex` | 0.69% | 822.06 ms | 411.03 ms | 2 |
| `c++/13/bits/chrono.h` | 0.68% | 810.5 ms | 405.25 ms | 2 |
| `boost/system/result.hpp` | 0.65% | 768.29 ms | 384.15 ms | 2 |
| `boost/config/detail/select_stdlib_config.hpp` | 0.63% | 750.86 ms | 375.43 ms | 2 |
| `boost/system/detail/append_int.hpp` | 0.62% | 735.7 ms | 367.85 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/stddef.h` | 0.61% | 729.04 ms | 182.26 ms | 4 |
| `boost/system/detail/snprintf.hpp` | 0.61% | 726.29 ms | 363.14 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/stdarg.h` | 0.56% | 668.0 ms | 167.0 ms | 4 |
| `c++/13/bits/char_traits.h` | 0.56% | 662.31 ms | 331.16 ms | 2 |
| `c++/13/version` | 0.55% | 654.52 ms | 327.26 ms | 2 |
| `boost/variant2/variant.hpp` | 0.53% | 630.66 ms | 315.33 ms | 2 |
| `boost/url/grammar/charset.hpp` | 0.49% | 588.12 ms | 588.12 ms | 1 |
| `c++/13/cstddef` | 0.49% | 580.63 ms | 290.32 ms | 2 |
| `boost/url/grammar/string_token.hpp` | 0.49% | 580.15 ms | 290.07 ms | 2 |
| `boost/url/grammar/detail/charset.hpp` | 0.48% | 576.89 ms | 576.89 ms | 1 |
| `c++/13/cstdarg` | 0.48% | 576.46 ms | 288.23 ms | 2 |
| `c++/13/atomic` | 0.48% | 575.39 ms | 287.7 ms | 2 |
| `c++/13/bits/cpp_type_traits.h` | 0.48% | 565.73 ms | 282.87 ms | 2 |
| `x86_64-linux-gnu/c++/13/bits/c++config.h` | 0.46% | 552.59 ms | 276.3 ms | 2 |
| `c++/13/bits/atomic_base.h` | 0.46% | 544.78 ms | 272.39 ms | 2 |
| `x86_64-linux-gnu/c++/13/bits/gthr.h` | 0.45% | 540.94 ms | 270.47 ms | 2 |
| `x86_64-linux-gnu/c++/13/bits/gthr-default.h` | 0.45% | 540.72 ms | 270.36 ms | 2 |
| `c++/13/bits/atomic_wait.h` | 0.44% | 519.61 ms | 259.8 ms | 2 |
| `boost/mp11.hpp` | 0.41% | 488.82 ms | 244.41 ms | 2 |
| `unistd.h` | 0.41% | 484.68 ms | 242.34 ms | 2 |
| `c++/13/cerrno` | 0.39% | 463.97 ms | 231.98 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/emmintrin.h` | 0.37% | 443.39 ms | 443.39 ms | 1 |
| `c++/13/bits/postypes.h` | 0.35% | 414.17 ms | 207.08 ms | 2 |
| `c++/13/bits/ios_base.h` | 0.34% | 404.41 ms | 202.2 ms | 2 |
| `x86_64-linux-gnu/c++/13/bits/os_defines.h` | 0.33% | 398.33 ms | 199.17 ms | 2 |
| `pthread.h` | 0.3% | 362.17 ms | 181.08 ms | 2 |
| `boost/config/platform/linux.hpp` | 0.3% | 359.55 ms | 179.78 ms | 2 |
| `c++/13/ostream` | 0.3% | 352.52 ms | 176.26 ms | 2 |
| `c++/13/memory` | 0.29% | 349.26 ms | 174.63 ms | 2 |
| `c++/13/bits/basic_ios.h` | 0.29% | 345.99 ms | 173.0 ms | 2 |
| `c++/13/bits/locale_facets.h` | 0.29% | 341.88 ms | 170.94 ms | 2 |
| `boost/url/grammar/string_view_base.hpp` | 0.28% | 336.5 ms | 168.25 ms | 2 |
| `errno.h` | 0.27% | 324.01 ms | 162.0 ms | 2 |
| `x86_64-linux-gnu/bits/errno.h` | 0.27% | 323.2 ms | 161.6 ms | 2 |
| `linux/errno.h` | 0.27% | 323.08 ms | 161.54 ms | 2 |
| `boost/throw_exception.hpp` | 0.27% | 322.19 ms | 161.1 ms | 2 |
| `c++/13/cwchar` | 0.27% | 321.29 ms | 160.64 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/xmmintrin.h` | 0.26% | 313.87 ms | 313.87 ms | 1 |
| `features.h` | 0.26% | 310.32 ms | 155.16 ms | 2 |
| `c++/13/cstring` | 0.25% | 297.53 ms | 148.77 ms | 2 |
| `c++/13/cstdlib` | 0.25% | 292.78 ms | 146.39 ms | 2 |
| `c++/13/ratio` | 0.24% | 288.43 ms | 144.21 ms | 2 |
| `c++/13/ext/atomicity.h` | 0.23% | 270.63 ms | 135.31 ms | 2 |
| `boost/config/compiler/clang.hpp` | 0.22% | 260.6 ms | 130.3 ms | 2 |
| `c++/13/bits/stl_construct.h` | 0.21% | 248.38 ms | 124.19 ms | 2 |
| `c++/13/bits/localefwd.h` | 0.2% | 244.04 ms | 122.02 ms | 2 |
| `x86_64-linux-gnu/c++/13/bits/c++locale.h` | 0.2% | 242.89 ms | 121.44 ms | 2 |
| `c++/13/bits/shared_ptr_atomic.h` | 0.19% | 231.72 ms | 115.86 ms | 2 |
| `boost/system/system_error.hpp` | 0.19% | 228.62 ms | 114.31 ms | 2 |
| `boost/system/detail/generic_category.hpp` | 0.19% | 228.47 ms | 114.24 ms | 2 |
| `boost/system/detail/generic_category_message.hpp` | 0.18% | 220.04 ms | 220.04 ms | 1 |
| `c++/13/bits/uses_allocator_args.h` | 0.18% | 219.79 ms | 109.9 ms | 2 |
| `test_suite.hpp` | 0.18% | 218.97 ms | 109.48 ms | 2 |
| `c++/13/sstream` | 0.18% | 214.75 ms | 107.37 ms | 2 |
| `wchar.h` | 0.18% | 211.88 ms | 105.94 ms | 2 |
| `c++/13/iosfwd` | 0.17% | 206.95 ms | 103.47 ms | 2 |
| `boost/mp11/list.hpp` | 0.17% | 205.06 ms | 102.53 ms | 2 |
| `c++/13/system_error` | 0.17% | 204.18 ms | 102.09 ms | 2 |
| `boost/mp11/algorithm.hpp` | 0.17% | 199.3 ms | 99.65 ms | 2 |
| `sched.h` | 0.15% | 181.68 ms | 90.84 ms | 2 |
| `boost/exception/exception.hpp` | 0.15% | 172.77 ms | 86.38 ms | 2 |
| `boost/url/detail/url_impl.hpp` | 0.14% | 167.44 ms | 167.44 ms | 1 |
| `c++/13/bits/stl_function.h` | 0.14% | 166.74 ms | 83.37 ms | 2 |
| `x86_64-linux-gnu/asm/errno.h` | 0.14% | 160.81 ms | 80.41 ms | 2 |
| `boost/url/scheme.hpp` | 0.13% | 153.94 ms | 153.94 ms | 1 |
| `string.h` | 0.13% | 150.1 ms | 75.05 ms | 2 |
| `c++/13/cwctype` | 0.13% | 149.99 ms | 74.99 ms | 2 |
| `c++/13/cstdio` | 0.12% | 148.25 ms | 74.12 ms | 2 |
| `c++/13/cstdint` | 0.12% | 139.99 ms | 70.0 ms | 2 |
| `c++/13/bits/range_access.h` | 0.12% | 139.02 ms | 69.51 ms | 2 |
| `c++/13/cctype` | 0.12% | 137.24 ms | 68.62 ms | 2 |


</details>

## Symbols

### Parse

Total Time: 2.91 s

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `/usr/include/unistd.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 11.14% | 323.84 ms | 161.92 ms | 2 |
| `/usr/include/stdlib.h:34:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 7.88% | 228.9 ms | 114.45 ms | 2 |
| `/usr/include/string.h:28:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 5.16% | 149.82 ms | 74.91 ms | 2 |
| `/usr/include/string.h:458:1` | 5.04% | 146.5 ms | 73.25 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/exception:38:1` | 3.27% | 94.96 ms | 47.48 ms | 2 |
| `/usr/include/unistd.h:1208:1` | 3.06% | 88.84 ms | 44.42 ms | 2 |
| `/usr/include/x86_64-linux-gnu/bits/unistd_ext.h:34:1` | 3.05% | 88.69 ms | 44.35 ms | 2 |
| `/usr/include/stdlib.h:257:1` | 2.96% | 86.03 ms | 43.02 ms | 2 |


<details>
<summary>More...</summary>

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `/usr/include/unistd.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 11.14% | 323.84 ms | 161.92 ms | 2 |
| `/usr/include/stdlib.h:34:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 7.88% | 228.9 ms | 114.45 ms | 2 |
| `/usr/include/string.h:28:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 5.16% | 149.82 ms | 74.91 ms | 2 |
| `/usr/include/string.h:458:1` | 5.04% | 146.5 ms | 73.25 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/exception:38:1` | 3.27% | 94.96 ms | 47.48 ms | 2 |
| `/usr/include/unistd.h:1208:1` | 3.06% | 88.84 ms | 44.42 ms | 2 |
| `/usr/include/x86_64-linux-gnu/bits/unistd_ext.h:34:1` | 3.05% | 88.69 ms | 44.35 ms | 2 |
| `/usr/include/stdlib.h:257:1` | 2.96% | 86.03 ms | 43.02 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/test/unit/authority_view.cpp:20:1` | 2.8% | 81.27 ms | 81.27 ms | 1 |
| `boost::urls::authority_view_test` | 2.79% | 81.21 ms | 81.21 ms | 1 |
| `std::vector` | 2.6% | 75.51 ms | 18.88 ms | 4 |
| `/usr/include/stdlib.h:389:1` | 2.52% | 73.34 ms | 36.67 ms | 2 |
| `/usr/include/x86_64-linux-gnu/sys/types.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 2.52% | 73.2 ms | 36.6 ms | 2 |
| `/usr/include/stdlib.h:582:1` | 2.16% | 62.64 ms | 31.32 ms | 2 |
| `operator""sv` | 2.11% | 61.22 ms | 6.12 ms | 10 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/grammar/string_view_base.hpp:36:1` | 1.92% | 55.71 ms | 27.86 ms | 2 |
| `boost::urls::grammar::string_view_base` | 1.91% | 55.59 ms | 27.79 ms | 2 |
| `operator""s` | 0.88% | 25.51 ms | 2.32 ms | 11 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/pct_string_view.hpp:73:1` | 0.72% | 20.85 ms | 10.42 ms | 2 |
| `boost::urls::pct_string_view` | 0.72% | 20.8 ms | 10.4 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/test/unit/decode_view.cpp:20:1` | 0.7% | 20.3 ms | 20.3 ms | 1 |
| `boost::urls::decode_view_test` | 0.7% | 20.28 ms | 20.28 ms | 1 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/error_code.hpp:64:1` | 0.69% | 20.12 ms | 10.06 ms | 2 |
| `boost::system::error_code` | 0.69% | 20.1 ms | 10.05 ms | 2 |
| `std::tuple` | 0.64% | 18.58 ms | 4.65 ms | 4 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/chrono.h:1236:5` | 0.63% | 18.44 ms | 9.22 ms | 2 |
| `std::chrono::system_clock` | 0.63% | 18.42 ms | 9.21 ms | 2 |
| `std::char_traits` | 0.61% | 17.59 ms | 1.76 ms | 10 |
| `std::basic_string` | 0.57% | 16.7 ms | 8.35 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:861:5` | 0.56% | 16.22 ms | 8.11 ms | 2 |
| `boost::variant2::detail::variant_base_impl` | 0.51% | 14.95 ms | 1.87 ms | 8 |
| `std::atomic` | 0.48% | 13.95 ms | 820.65 µs | 17 |
| `boost::variant2::detail::variant_storage_impl` | 0.42% | 12.2 ms | 1.53 ms | 8 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/max_size_type.h:59:5` | 0.41% | 11.98 ms | 5.99 ms | 2 |
| `std::ranges::__detail::__max_size_type` | 0.41% | 11.95 ms | 5.98 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:875:5` | 0.4% | 11.48 ms | 5.74 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:870:5` | 0.39% | 11.3 ms | 5.65 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:865:5` | 0.39% | 11.27 ms | 5.64 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:879:5` | 0.39% | 11.27 ms | 5.64 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/system_error:556:3` | 0.37% | 10.68 ms | 5.34 ms | 2 |
| `std::system_error` | 0.37% | 10.66 ms | 5.33 ms | 2 |
| `_M_extract_float` | 0.36% | 10.36 ms | 5.18 ms | 2 |
| `std::__atomic_base` | 0.34% | 9.83 ms | 2.46 ms | 4 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/max_size_type.h:440:5` | 0.33% | 9.68 ms | 4.84 ms | 2 |
| `std::ranges::__detail::__max_diff_type` | 0.33% | 9.66 ms | 4.83 ms | 2 |
| `stoi` | 0.33% | 9.58 ms | 2.4 ms | 4 |
| `boost::variant2::variant` | 0.31% | 9.05 ms | 4.53 ms | 2 |
| `std::_Hashtable` | 0.3% | 8.85 ms | 4.42 ms | 2 |
| `boost::core::basic_string_view` | 0.3% | 8.71 ms | 4.36 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/error_condition.hpp:44:1` | 0.3% | 8.71 ms | 4.35 ms | 2 |
| `boost::system::error_condition` | 0.3% | 8.69 ms | 4.34 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4484:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.3% | 8.65 ms | 4.33 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/system_category_impl.hpp:56:1` | 0.28% | 8.19 ms | 4.09 ms | 2 |
| `std::basic_stringbuf` | 0.25% | 7.35 ms | 3.68 ms | 2 |
| `boost::system::result` | 0.25% | 7.31 ms | 1.83 ms | 4 |
| `std::__shared_ptr` | 0.25% | 7.28 ms | 3.64 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/assert/include/boost/assert/source_location.hpp:26:1` | 0.25% | 7.17 ms | 3.58 ms | 2 |
| `boost::source_location` | 0.25% | 7.14 ms | 3.57 ms | 2 |
| `/usr/include/pthread.h:197:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 0.24% | 6.98 ms | 3.49 ms | 2 |
| `equivalent` | 0.24% | 6.97 ms | 1.74 ms | 4 |
| `std::_Sp_atomic` | 0.24% | 6.96 ms | 3.48 ms | 2 |
| `std::unique_ptr` | 0.24% | 6.94 ms | 1.73 ms | 4 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4490:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.24% | 6.89 ms | 3.45 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4495:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.23% | 6.74 ms | 3.37 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/ipv6_address.hpp:64:1` | 0.22% | 6.51 ms | 6.51 ms | 1 |
| `boost::urls::ipv6_address` | 0.22% | 6.49 ms | 6.49 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/hashtable_policy.h:614:3` | 0.21% | 6.15 ms | 3.08 ms | 2 |
| `std::__detail::_Power2_rehash_policy` | 0.21% | 6.13 ms | 3.07 ms | 2 |
| `std::numeric_limits` | 0.19% | 5.55 ms | 555.3 µs | 10 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/grammar/string_token.hpp:139:1` | 0.19% | 5.4 ms | 2.7 ms | 2 |
| `boost::urls::string_token::implementation_defined::return_string` | 0.19% | 5.38 ms | 2.69 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4107:3` | 0.18% | 5.27 ms | 2.64 ms | 2 |
| `std::chrono::duration` | 0.18% | 5.24 ms | 2.62 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/system_error:106:3` | 0.17% | 5.01 ms | 2.51 ms | 2 |
| `std::error_category` | 0.17% | 5.0 ms | 2.5 ms | 2 |
| `boost::mp11::detail::mp_with_index_impl_` | 0.17% | 4.92 ms | 703.14 µs | 7 |
| `std::__shared_count` | 0.17% | 4.85 ms | 2.43 ms | 2 |
| `to_string` | 0.16% | 4.76 ms | 1.59 ms | 3 |
| `std::unordered_map` | 0.16% | 4.74 ms | 2.37 ms | 2 |
| `_M_extract_int` | 0.16% | 4.73 ms | 2.37 ms | 2 |
| `std::shared_ptr` | 0.16% | 4.64 ms | 2.32 ms | 2 |
| `/usr/include/stdio.h:29:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 0.16% | 4.58 ms | 2.29 ms | 2 |
| `std::_Sp_counted_deleter` | 0.15% | 4.48 ms | 2.24 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/system_error.hpp:20:1` | 0.15% | 4.47 ms | 2.23 ms | 2 |
| `std::basic_string_view` | 0.15% | 4.43 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:275:3` | 0.15% | 4.43 ms | 2.21 ms | 2 |
| `boost::system::system_error` | 0.15% | 4.42 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4259:3` | 0.15% | 4.41 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/ios_base.h:233:3` | 0.15% | 4.41 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:381:3` | 0.15% | 4.4 ms | 2.2 ms | 2 |
| `std::_Bit_iterator` | 0.15% | 4.4 ms | 2.2 ms | 2 |
| `std::ios_base` | 0.15% | 4.39 ms | 2.19 ms | 2 |
| `std::_Bit_const_iterator` | 0.15% | 4.38 ms | 2.19 ms | 2 |
| `boost::urls::string_token::implementation_defined::preserve_size_t` | 0.15% | 4.36 ms | 2.18 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4149:3` | 0.15% | 4.29 ms | 2.14 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/std_category_impl.hpp:29:1` | 0.14% | 4.11 ms | 2.05 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/emmintrin.h:4409:1` | 0.14% | 4.05 ms | 4.05 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:78:3` | 0.14% | 3.98 ms | 1.99 ms | 2 |
| `_mm_unpackhi_epi64` | 0.14% | 3.98 ms | 3.98 ms | 1 |
| `std::common_iterator` | 0.14% | 3.95 ms | 1.98 ms | 2 |
| `std::_Bit_reference` | 0.14% | 3.93 ms | 1.96 ms | 2 |


</details>

### Instantiate

Total Time: 709.12 ms

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost::system::result<boost::urls::authority_view>` | 4.82% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>` | 4.05% | 28.73 ms | 28.73 ms | 1 |
| `std::reverse_iterator<std::_Bit_iterator>` | 4.02% | 28.48 ms | 14.24 ms | 2 |
| `std::reverse_iterator<std::_Bit_const_iterator>` | 3.07% | 21.75 ms | 10.88 ms | 2 |
| `std::unordered_map<int, int>` | 2.54% | 18.04 ms | 9.02 ms | 2 |
| `std::swap<unsigned long>` | 1.99% | 14.11 ms | 7.06 ms | 2 |
| `std::_Hashtable<int, std::pair<const int, int>, std::allocator<std::pair<const int, int>>, std::__detail::_Select1st, std::equal_to<int>, std::hash<int>, std::__detail::_Mod_range_hashing, std::__detail::_Default_ranged_hash, std::__detail::_Prime_rehash_policy, std::__detail::_Hashtable_traits<false, false, true>>` | 1.96% | 13.92 ms | 6.96 ms | 2 |
| `__gnu_cxx::__to_xstring<std::basic_string<wchar_t>, wchar_t>` | 1.45% | 10.29 ms | 5.15 ms | 2 |


<details>
<summary>More...</summary>

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost::system::result<boost::urls::authority_view>` | 4.82% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>` | 4.05% | 28.73 ms | 28.73 ms | 1 |
| `std::reverse_iterator<std::_Bit_iterator>` | 4.02% | 28.48 ms | 14.24 ms | 2 |
| `std::reverse_iterator<std::_Bit_const_iterator>` | 3.07% | 21.75 ms | 10.88 ms | 2 |
| `std::unordered_map<int, int>` | 2.54% | 18.04 ms | 9.02 ms | 2 |
| `std::swap<unsigned long>` | 1.99% | 14.11 ms | 7.06 ms | 2 |
| `std::_Hashtable<int, std::pair<const int, int>, std::allocator<std::pair<const int, int>>, std::__detail::_Select1st, std::equal_to<int>, std::hash<int>, std::__detail::_Mod_range_hashing, std::__detail::_Default_ranged_hash, std::__detail::_Prime_rehash_policy, std::__detail::_Hashtable_traits<false, false, true>>` | 1.96% | 13.92 ms | 6.96 ms | 2 |
| `__gnu_cxx::__to_xstring<std::basic_string<wchar_t>, wchar_t>` | 1.45% | 10.29 ms | 5.15 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned long, unsigned int>` | 1.4% | 9.94 ms | 4.97 ms | 2 |
| `std::__and_<std::is_nothrow_move_constructible<unsigned long>, std::is_nothrow_move_assignable<unsigned long>>` | 1.39% | 9.85 ms | 9.85 ms | 1 |
| `boost::variant2::detail::variant_ma_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 1.16% | 8.21 ms | 8.21 ms | 1 |
| `std::operator+<char, std::char_traits<char>, std::allocator<char>>` | 1.05% | 7.44 ms | 1.86 ms | 4 |
| `boost::variant2::detail::variant_mc_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 1.01% | 7.17 ms | 7.17 ms | 1 |
| `std::basic_stringstream<char>::str` | 1.0% | 7.09 ms | 3.55 ms | 2 |
| `std::basic_stringbuf<char>::str` | 0.99% | 7.03 ms | 3.52 ms | 2 |
| `std::basic_string<char>::resize` | 0.97% | 6.86 ms | 1.71 ms | 4 |
| `boost::system::result<boost::urls::authority_view>::value<boost::urls::authority_view>` | 0.88% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<boost::urls::authority_view>::value` | 0.85% | 6.03 ms | 6.03 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[1]>` | 0.83% | 5.87 ms | 5.87 ms | 1 |
| `std::basic_string<char32_t>::_M_construct<const char32_t *>` | 0.82% | 5.82 ms | 2.91 ms | 2 |
| `std::basic_string<char8_t>::_M_construct<const char8_t *>` | 0.78% | 5.55 ms | 2.78 ms | 2 |
| `std::basic_string<char8_t>` | 0.77% | 5.48 ms | 2.74 ms | 2 |
| `std::unordered_multimap<int, int>` | 0.76% | 5.41 ms | 2.7 ms | 2 |
| `std::basic_string<char16_t>::_M_construct<const char16_t *>` | 0.7% | 4.94 ms | 2.47 ms | 2 |
| `std::basic_string<char>` | 0.68% | 4.8 ms | 2.4 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[2]>` | 0.67% | 4.72 ms | 4.72 ms | 1 |
| `boost::variant2::detail::variant_ca_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 0.66% | 4.66 ms | 4.66 ms | 1 |
| `std::basic_string<wchar_t>::basic_string<wchar_t *, void>` | 0.66% | 4.65 ms | 2.32 ms | 2 |
| `std::chrono::time_point_cast<std::chrono::duration<long, std::ratio<1, 1000000000>>, std::chrono::system_clock, std::chrono::duration<long>>` | 0.63% | 4.46 ms | 2.23 ms | 2 |
| `std::filesystem::__file_clock::_S_from_sys<std::chrono::duration<long, std::ratio<1, 1000000000>>>` | 0.6% | 4.23 ms | 2.12 ms | 2 |
| `std::_Hashtable<int, std::pair<const int, int>, std::allocator<std::pair<const int, int>>, std::__detail::_Select1st, std::equal_to<int>, std::hash<int>, std::__detail::_Mod_range_hashing, std::__detail::_Default_ranged_hash, std::__detail::_Prime_rehash_policy, std::__detail::_Hashtable_traits<false, false, false>>` | 0.59% | 4.18 ms | 2.09 ms | 2 |
| `std::basic_string<wchar_t>::_M_construct<wchar_t *>` | 0.58% | 4.09 ms | 2.05 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned short, int>` | 0.58% | 4.09 ms | 4.09 ms | 1 |
| `std::__and_<std::__not_<std::__is_tuple_like<boost::core::basic_string_view<char>>>, std::is_move_constructible<boost::core::basic_string_view<char>>, std::is_move_assignable<boost::core::basic_string_view<char>>>` | 0.57% | 4.05 ms | 2.03 ms | 2 |
| `std::basic_string<char16_t>` | 0.57% | 4.02 ms | 2.01 ms | 2 |
| `std::basic_string<wchar_t>` | 0.57% | 4.01 ms | 2.01 ms | 2 |
| `boost::variant2::detail::variant_cc_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 0.56% | 3.99 ms | 3.99 ms | 1 |
| `std::basic_string<char32_t>` | 0.54% | 3.82 ms | 1.91 ms | 2 |
| `boost::core::basic_string_view<char>` | 0.51% | 3.64 ms | 1.82 ms | 2 |
| `std::basic_string<char>::assign<char *, void>` | 0.51% | 3.6 ms | 1.8 ms | 2 |
| `std::is_nothrow_move_constructible<unsigned long>` | 0.5% | 3.54 ms | 3.54 ms | 1 |
| `std::basic_string<char>::basic_string<std::allocator<char>>` | 0.5% | 3.54 ms | 1.77 ms | 2 |
| `boost::core::basic_string_view<char>::find_last_not_of` | 0.49% | 3.5 ms | 875.75 µs | 4 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[6]>` | 0.49% | 3.44 ms | 3.44 ms | 1 |
| `std::__and_<std::__not_<std::__is_tuple_like<unsigned long>>, std::is_move_constructible<unsigned long>, std::is_move_assignable<unsigned long>>` | 0.48% | 3.43 ms | 1.72 ms | 2 |
| `std::__atomic_wait_address_v<bool, (lambda at /usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/atomic_base.h:265:4)>` | 0.48% | 3.41 ms | 1.71 ms | 2 |
| `std::is_nothrow_move_assignable<unsigned long>` | 0.48% | 3.41 ms | 3.41 ms | 1 |
| `std::is_trivially_destructible<boost::urls::authority_view>` | 0.47% | 3.35 ms | 3.35 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[2]>` | 0.46% | 3.29 ms | 3.29 ms | 1 |
| `std::is_object<wchar_t>` | 0.46% | 3.29 ms | 3.29 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[8]>` | 0.46% | 3.26 ms | 3.26 ms | 1 |
| `std::__and_<std::is_default_constructible<std::equal_to<int>>, std::is_default_constructible<std::hash<int>>, std::is_default_constructible<std::allocator<std::pair<const int, int>>>>` | 0.46% | 3.26 ms | 1.63 ms | 2 |
| `std::operator==<unsigned char, 16UL>` | 0.46% | 3.24 ms | 3.24 ms | 1 |
| `std::__not_<std::__or_<std::is_function<wchar_t>, std::is_reference<wchar_t>, std::is_void<wchar_t>>>` | 0.46% | 3.23 ms | 3.23 ms | 1 |
| `std::is_trivially_destructible<boost::variant2::detail::none>` | 0.45% | 3.22 ms | 1.61 ms | 2 |
| `std::basic_string<char>::_M_construct<const char *>` | 0.45% | 3.21 ms | 1.6 ms | 2 |
| `std::__detail::_Insert<int, std::pair<const int, int>, std::allocator<std::pair<const int, int>>, std::__detail::_Select1st, std::equal_to<int>, std::hash<int>, std::__detail::_Mod_range_hashing, std::__detail::_Default_ranged_hash, std::__detail::_Prime_rehash_policy, std::__detail::_Hashtable_traits<false, false, true>>` | 0.45% | 3.2 ms | 1.6 ms | 2 |
| `boost::mp11::detail::mp_count_impl<boost::mp11::mp_list<std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>>, std::integral_constant<bool, false>>` | 0.45% | 3.19 ms | 3.19 ms | 1 |
| `std::__or_<std::is_function<wchar_t>, std::is_reference<wchar_t>, std::is_void<wchar_t>>` | 0.45% | 3.16 ms | 3.16 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[1]>` | 0.44% | 3.14 ms | 3.14 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[4]>` | 0.43% | 3.04 ms | 3.04 ms | 1 |
| `boost::core::basic_string_view<char>::find_first_of` | 0.42% | 3.0 ms | 751.25 µs | 4 |
| `std::__str_concat<std::basic_string<char>>` | 0.42% | 2.97 ms | 1.49 ms | 2 |
| `std::__detail::_Insert_base<int, std::pair<const int, int>, std::allocator<std::pair<const int, int>>, std::__detail::_Select1st, std::equal_to<int>, std::hash<int>, std::__detail::_Mod_range_hashing, std::__detail::_Default_ranged_hash, std::__detail::_Prime_rehash_policy, std::__detail::_Hashtable_traits<false, false, true>>` | 0.42% | 2.95 ms | 1.48 ms | 2 |
| `std::copy<unsigned long *, unsigned long *>` | 0.42% | 2.94 ms | 1.47 ms | 2 |
| `boost::core::basic_string_view<char>::starts_with` | 0.41% | 2.93 ms | 1.47 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[3]>` | 0.41% | 2.92 ms | 2.92 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>` | 0.41% | 2.89 ms | 2.89 ms | 1 |
| `std::chrono::duration_cast<std::chrono::duration<long>, long, std::ratio<1, 1000000000>>` | 0.41% | 2.88 ms | 1.44 ms | 2 |
| `std::equal<const unsigned char *, const unsigned char *>` | 0.41% | 2.88 ms | 2.88 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[1]>` | 0.39% | 2.79 ms | 2.79 ms | 1 |
| `std::__equal_aux<const unsigned char *, const unsigned char *>` | 0.39% | 2.78 ms | 2.78 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_ne, const char *, std::nullptr_t>` | 0.39% | 2.74 ms | 2.74 ms | 1 |
| `std::pair<bool, unsigned long>` | 0.39% | 2.74 ms | 1.37 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[4]>` | 0.38% | 2.68 ms | 2.68 ms | 1 |
| `__gnu_cxx::__to_xstring<std::basic_string<char>, char>` | 0.37% | 2.63 ms | 1.32 ms | 2 |
| `std::basic_string<char>::replace` | 0.37% | 2.63 ms | 657.25 µs | 4 |
| `std::reverse_iterator<const char *>` | 0.37% | 2.61 ms | 1.3 ms | 2 |
| `std::swap<boost::core::basic_string_view<char>>` | 0.37% | 2.61 ms | 1.3 ms | 2 |
| `std::copy<std::_Bit_const_iterator, std::_Bit_iterator>` | 0.37% | 2.6 ms | 1.3 ms | 2 |
| `std::chrono::duration<long, std::ratio<1, 1000000000>>` | 0.36% | 2.57 ms | 1.29 ms | 2 |
| `std::__copy_move_a<false, unsigned long *, unsigned long *>` | 0.36% | 2.56 ms | 1.28 ms | 2 |
| `std::is_move_constructible<boost::urls::authority_view>` | 0.36% | 2.53 ms | 2.53 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, bool, bool>` | 0.35% | 2.52 ms | 2.52 ms | 1 |
| `std::chrono::operator-<std::filesystem::__file_clock, std::chrono::duration<long, std::ratio<1, 1000000000>>, long, std::ratio<1>>` | 0.35% | 2.52 ms | 1.26 ms | 2 |
| `std::is_move_constructible<boost::core::basic_string_view<char>>` | 0.34% | 2.43 ms | 1.21 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[2]>` | 0.34% | 2.43 ms | 2.43 ms | 1 |
| `std::__and_<std::__not_<std::__is_tuple_like<std::_Bit_iterator>>, std::is_move_constructible<std::_Bit_iterator>, std::is_move_assignable<std::_Bit_iterator>>` | 0.34% | 2.39 ms | 1.19 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[5]>` | 0.34% | 2.38 ms | 2.38 ms | 1 |
| `boost::throw_exception<std::out_of_range>` | 0.33% | 2.36 ms | 1.18 ms | 2 |
| `boost::mp11::detail::cx_count<std::integral_constant<bool, false>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>>` | 0.33% | 2.34 ms | 2.34 ms | 1 |
| `std::__copy_move_a<false, std::_Bit_const_iterator, std::_Bit_iterator>` | 0.32% | 2.27 ms | 1.14 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[31]>` | 0.32% | 2.27 ms | 2.27 ms | 1 |
| `std::common_reference<bool &&, bool &>` | 0.32% | 2.25 ms | 1.13 ms | 2 |
| `std::basic_string<char>::operator=` | 0.32% | 2.25 ms | 1.13 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[9]>` | 0.32% | 2.25 ms | 2.25 ms | 1 |
| `std::__or_<std::is_reference<boost::urls::authority_view>, std::is_scalar<boost::urls::authority_view>>` | 0.31% | 2.21 ms | 2.21 ms | 1 |
| `std::make_signed<int>` | 0.31% | 2.21 ms | 2.21 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, boost::core::basic_string_view<char>>` | 0.31% | 2.19 ms | 2.19 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[1]>` | 0.31% | 2.19 ms | 2.19 ms | 1 |
| `boost::variant2::detail::variant_storage_impl<std::integral_constant<bool, false>, boost::variant2::detail::none, boost::urls::authority_view, boost::system::error_code>` | 0.31% | 2.17 ms | 2.17 ms | 1 |


</details>

### Instantiate Sets

Total Time: 709.12 ms

| Symbol Set | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `test_suite::detail::test_with_impl<$>` | 12.54% | 88.92 ms | 2.78 ms | 32 |
| `std::reverse_iterator<$>` | 7.45% | 52.84 ms | 8.81 ms | 6 |
| `boost::system::result<$>` | 4.82% | 34.16 ms | 34.16 ms | 1 |
| `std::__and_<$>` | 4.63% | 32.86 ms | 1.56 ms | 21 |
| `boost::variant2::variant<$>` | 4.05% | 28.73 ms | 28.73 ms | 1 |
| `std::basic_string<$>::_M_construct<$>` | 3.55% | 25.15 ms | 2.1 ms | 12 |
| `std::basic_string<$>` | 3.12% | 22.13 ms | 2.21 ms | 10 |
| `std::common_reference<$>` | 2.81% | 19.94 ms | 766.96 µs | 26 |


<details>
<summary>More...</summary>

| Symbol Set | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `test_suite::detail::test_with_impl<$>` | 12.54% | 88.92 ms | 2.78 ms | 32 |
| `std::reverse_iterator<$>` | 7.45% | 52.84 ms | 8.81 ms | 6 |
| `boost::system::result<$>` | 4.82% | 34.16 ms | 34.16 ms | 1 |
| `std::__and_<$>` | 4.63% | 32.86 ms | 1.56 ms | 21 |
| `boost::variant2::variant<$>` | 4.05% | 28.73 ms | 28.73 ms | 1 |
| `std::basic_string<$>::_M_construct<$>` | 3.55% | 25.15 ms | 2.1 ms | 12 |
| `std::basic_string<$>` | 3.12% | 22.13 ms | 2.21 ms | 10 |
| `std::common_reference<$>` | 2.81% | 19.94 ms | 766.96 µs | 26 |
| `std::_Hashtable<$>` | 2.55% | 18.1 ms | 4.53 ms | 4 |
| `std::unordered_map<$>` | 2.54% | 18.04 ms | 9.02 ms | 2 |
| `std::__or_<$>` | 2.54% | 17.99 ms | 1.06 ms | 17 |
| `std::swap<$>` | 2.36% | 16.72 ms | 4.18 ms | 4 |
| `__gnu_cxx::__to_xstring<$>` | 1.82% | 12.92 ms | 3.23 ms | 4 |
| `std::basic_string<$>::basic_string<$>` | 1.67% | 11.83 ms | 1.48 ms | 8 |
| `std::is_move_constructible<$>` | 1.43% | 10.11 ms | 1.26 ms | 8 |
| `std::is_trivially_destructible<$>` | 1.22% | 8.67 ms | 2.17 ms | 4 |
| `boost::variant2::detail::variant_ma_base_impl<$>` | 1.16% | 8.21 ms | 8.21 ms | 1 |
| `std::chrono::duration<$>` | 1.15% | 8.18 ms | 817.8 µs | 10 |
| `std::__not_<$>` | 1.11% | 7.85 ms | 1.12 ms | 7 |
| `std::operator+<$>` | 1.05% | 7.44 ms | 1.86 ms | 4 |
| `boost::variant2::detail::variant_mc_base_impl<$>` | 1.01% | 7.17 ms | 7.17 ms | 1 |
| `std::basic_stringstream<$>::str` | 1.0% | 7.09 ms | 3.55 ms | 2 |
| `std::basic_stringbuf<$>::str` | 0.99% | 7.03 ms | 3.52 ms | 2 |
| `std::basic_string<$>::resize` | 0.97% | 6.86 ms | 1.71 ms | 4 |
| `boost::system::result<$>::value<$>` | 0.88% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<$>::value` | 0.85% | 6.03 ms | 6.03 ms | 1 |
| `std::copy<$>` | 0.78% | 5.54 ms | 1.39 ms | 4 |
| `std::unordered_multimap<$>` | 0.76% | 5.41 ms | 2.7 ms | 2 |
| `std::is_object<$>` | 0.72% | 5.12 ms | 1.28 ms | 4 |
| `__gnu_cxx::__normal_iterator<$>` | 0.7% | 4.95 ms | 825.5 µs | 6 |
| `std::__copy_move_a<$>` | 0.68% | 4.83 ms | 1.21 ms | 4 |
| `std::__atomic_wait_address_v<$>` | 0.68% | 4.79 ms | 1.2 ms | 4 |
| `boost::throw_with_location<$>` | 0.66% | 4.7 ms | 1.17 ms | 4 |
| `boost::variant2::detail::variant_ca_base_impl<$>` | 0.66% | 4.66 ms | 4.66 ms | 1 |
| `std::is_scalar<$>` | 0.64% | 4.53 ms | 906.4 µs | 5 |
| `std::__common_ref_impl<$>` | 0.63% | 4.5 ms | 643.14 µs | 7 |
| `boost::variant2::detail::variant_storage_impl<$>` | 0.63% | 4.48 ms | 1.49 ms | 3 |
| `std::chrono::time_point_cast<$>` | 0.63% | 4.46 ms | 2.23 ms | 2 |
| `std::chrono::duration_cast<$>` | 0.62% | 4.42 ms | 1.1 ms | 4 |
| `std::chrono::operator-<$>` | 0.61% | 4.32 ms | 1.08 ms | 4 |
| `std::filesystem::__file_clock::_S_from_sys<$>` | 0.6% | 4.23 ms | 2.12 ms | 2 |
| `boost::variant2::detail::variant_cc_base_impl<$>` | 0.56% | 3.99 ms | 3.99 ms | 1 |
| `boost::core::basic_string_view<$>` | 0.51% | 3.64 ms | 1.82 ms | 2 |
| `std::basic_string<$>::assign<$>` | 0.51% | 3.6 ms | 1.8 ms | 2 |
| `std::is_nothrow_move_constructible<$>` | 0.5% | 3.54 ms | 3.54 ms | 1 |
| `boost::core::basic_string_view<$>::find_last_not_of` | 0.49% | 3.5 ms | 875.75 µs | 4 |
| `std::is_nothrow_move_assignable<$>` | 0.48% | 3.41 ms | 3.41 ms | 1 |
| `__gnu_cxx::__stoa<$>` | 0.48% | 3.4 ms | 566.83 µs | 6 |
| `std::operator==<$>` | 0.46% | 3.24 ms | 3.24 ms | 1 |
| `std::__detail::_Insert<$>` | 0.45% | 3.2 ms | 1.6 ms | 2 |
| `boost::mp11::detail::mp_count_impl<$>` | 0.45% | 3.19 ms | 3.19 ms | 1 |
| `boost::variant2::unsafe_get<$>` | 0.45% | 3.18 ms | 1.59 ms | 2 |
| `boost::core::basic_string_view<$>::find_first_of` | 0.42% | 3.0 ms | 751.25 µs | 4 |
| `std::__str_concat<$>` | 0.42% | 2.97 ms | 1.49 ms | 2 |
| `std::__detail::_Insert_base<$>` | 0.42% | 2.95 ms | 1.48 ms | 2 |
| `boost::core::basic_string_view<$>::starts_with` | 0.41% | 2.93 ms | 1.47 ms | 2 |
| `boost::variant2::detail::variant_base_impl<$>` | 0.41% | 2.89 ms | 2.89 ms | 1 |
| `std::equal<$>` | 0.41% | 2.88 ms | 2.88 ms | 1 |
| `std::__equal_aux<$>` | 0.39% | 2.78 ms | 2.78 ms | 1 |
| `std::pair<$>` | 0.39% | 2.74 ms | 1.37 ms | 2 |
| `std::chrono::time_point<$>::time_point` | 0.38% | 2.7 ms | 1.35 ms | 2 |
| `std::basic_string<$>::replace` | 0.37% | 2.63 ms | 657.25 µs | 4 |
| `test_suite::detail::lw_test_eq::operator()<$>` | 0.34% | 2.4 ms | 800.33 µs | 3 |
| `boost::variant2::detail::variant_base_impl<$>::_get_impl<$>` | 0.33% | 2.36 ms | 1.18 ms | 2 |
| `boost::throw_exception<$>` | 0.33% | 2.36 ms | 1.18 ms | 2 |
| `boost::mp11::detail::cx_count<$>` | 0.33% | 2.34 ms | 2.34 ms | 1 |
| `std::basic_string<$>::basic_string` | 0.32% | 2.27 ms | 567.0 µs | 4 |
| `std::basic_string<$>::operator=` | 0.32% | 2.25 ms | 1.13 ms | 2 |
| `std::make_signed<$>` | 0.31% | 2.21 ms | 2.21 ms | 1 |
| `std::chrono::operator<$><$>` | 0.3% | 2.16 ms | 1.08 ms | 2 |
| `std::basic_string<$>::~basic_string` | 0.3% | 2.14 ms | 534.0 µs | 4 |
| `std::__make_signed_selector<$>` | 0.3% | 2.13 ms | 2.13 ms | 1 |
| `std::__detail::__waiter<$>::_M_do_wait_v<$>` | 0.3% | 2.1 ms | 699.0 µs | 3 |
| `std::basic_string<$>::assign` | 0.29% | 2.08 ms | 1.04 ms | 2 |
| `std::basic_string<$>::_M_create` | 0.29% | 2.07 ms | 690.67 µs | 3 |
| `boost::variant2::detail::variant_base_impl<$>::~variant_base_impl` | 0.29% | 2.06 ms | 2.06 ms | 1 |
| `std::__niter_base<$>` | 0.29% | 2.05 ms | 1.03 ms | 2 |
| `std::basic_string<$>::insert` | 0.29% | 2.05 ms | 1.02 ms | 2 |
| `boost::variant2::detail::variant_base_impl<$>::_destroy` | 0.27% | 1.9 ms | 1.9 ms | 1 |
| `std::is_nothrow_copy_constructible<$>` | 0.27% | 1.89 ms | 947.0 µs | 2 |
| `boost::core::basic_string_view<$>::find_last_of` | 0.26% | 1.86 ms | 928.5 µs | 2 |
| `std::__atomic_base<$>::wait` | 0.25% | 1.79 ms | 896.0 µs | 2 |
| `std::__detail::_Hashtable_alloc<$>` | 0.25% | 1.77 ms | 886.0 µs | 2 |
| `std::__ratio_divide<$>` | 0.24% | 1.71 ms | 571.0 µs | 3 |
| `std::__is_nothrow_invocable<$>` | 0.24% | 1.68 ms | 840.0 µs | 2 |
| `std::basic_string<$>::append` | 0.21% | 1.46 ms | 730.5 µs | 2 |
| `boost::core::basic_string_view<$>::find_first_not_of` | 0.2% | 1.45 ms | 725.0 µs | 2 |
| `std::decay<$>` | 0.19% | 1.38 ms | 1.38 ms | 1 |
| `std::__copy_move_a1<$>` | 0.19% | 1.36 ms | 678.5 µs | 2 |
| `std::basic_string<$>::_M_replace_aux` | 0.18% | 1.28 ms | 639.0 µs | 2 |
| `std::basic_stringbuf<$>` | 0.18% | 1.25 ms | 626.5 µs | 2 |
| `std::__detail::_Hashtable_base<$>` | 0.17% | 1.23 ms | 613.5 µs | 2 |
| `std::is_default_constructible<$>` | 0.16% | 1.16 ms | 582.0 µs | 2 |
| `boost::variant2::variant_alternative<$>` | 0.16% | 1.16 ms | 579.5 µs | 2 |
| `boost::core::operator<$` | 0.16% | 1.14 ms | 1.14 ms | 1 |
| `std::chrono::time_point<$>` | 0.16% | 1.13 ms | 566.5 µs | 2 |
| `std::__equal_aux1<$>` | 0.16% | 1.13 ms | 1.13 ms | 1 |
| `std::__ratio_multiply<$>` | 0.16% | 1.1 ms | 551.0 µs | 2 |
| `std::__detail::__waiter<$>::__waiter<$>` | 0.15% | 1.06 ms | 1.06 ms | 1 |
| `std::__copy_move_a2<$>` | 0.15% | 1.06 ms | 529.5 µs | 2 |
| `std::basic_string<$>::_M_dispose` | 0.15% | 1.04 ms | 520.5 µs | 2 |


</details>

## Project Symbols

### Parse

Total Time: 2.46 s

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `/usr/include/unistd.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 13.16% | 323.84 ms | 161.92 ms | 2 |
| `/usr/include/stdlib.h:34:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 9.3% | 228.9 ms | 114.45 ms | 2 |
| `/usr/include/string.h:28:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 6.09% | 149.82 ms | 74.91 ms | 2 |
| `/usr/include/string.h:458:1` | 5.96% | 146.5 ms | 73.25 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/exception:38:1` | 3.86% | 94.96 ms | 47.48 ms | 2 |
| `/usr/include/unistd.h:1208:1` | 3.61% | 88.84 ms | 44.42 ms | 2 |
| `/usr/include/x86_64-linux-gnu/bits/unistd_ext.h:34:1` | 3.61% | 88.69 ms | 44.35 ms | 2 |
| `/usr/include/stdlib.h:257:1` | 3.5% | 86.03 ms | 43.02 ms | 2 |


<details>
<summary>More...</summary>

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `/usr/include/unistd.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 13.16% | 323.84 ms | 161.92 ms | 2 |
| `/usr/include/stdlib.h:34:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 9.3% | 228.9 ms | 114.45 ms | 2 |
| `/usr/include/string.h:28:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 6.09% | 149.82 ms | 74.91 ms | 2 |
| `/usr/include/string.h:458:1` | 5.96% | 146.5 ms | 73.25 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/exception:38:1` | 3.86% | 94.96 ms | 47.48 ms | 2 |
| `/usr/include/unistd.h:1208:1` | 3.61% | 88.84 ms | 44.42 ms | 2 |
| `/usr/include/x86_64-linux-gnu/bits/unistd_ext.h:34:1` | 3.61% | 88.69 ms | 44.35 ms | 2 |
| `/usr/include/stdlib.h:257:1` | 3.5% | 86.03 ms | 43.02 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/test/unit/authority_view.cpp:20:1` | 3.3% | 81.27 ms | 81.27 ms | 1 |
| `boost::urls::authority_view_test` | 3.3% | 81.21 ms | 81.21 ms | 1 |
| `/usr/include/stdlib.h:389:1` | 2.98% | 73.34 ms | 36.67 ms | 2 |
| `/usr/include/x86_64-linux-gnu/sys/types.h:27:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 2.98% | 73.2 ms | 36.6 ms | 2 |
| `/usr/include/stdlib.h:582:1` | 2.55% | 62.64 ms | 31.32 ms | 2 |
| `operator""sv` | 2.49% | 61.22 ms | 6.12 ms | 10 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/grammar/string_view_base.hpp:36:1` | 2.26% | 55.71 ms | 27.86 ms | 2 |
| `boost::urls::grammar::string_view_base` | 2.26% | 55.59 ms | 27.79 ms | 2 |
| `operator""s` | 1.04% | 25.51 ms | 2.32 ms | 11 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/pct_string_view.hpp:73:1` | 0.85% | 20.85 ms | 10.42 ms | 2 |
| `boost::urls::pct_string_view` | 0.85% | 20.8 ms | 10.4 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/test/unit/decode_view.cpp:20:1` | 0.83% | 20.3 ms | 20.3 ms | 1 |
| `boost::urls::decode_view_test` | 0.82% | 20.28 ms | 20.28 ms | 1 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/error_code.hpp:64:1` | 0.82% | 20.12 ms | 10.06 ms | 2 |
| `boost::system::error_code` | 0.82% | 20.1 ms | 10.05 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/chrono.h:1236:5` | 0.75% | 18.44 ms | 9.22 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:861:5` | 0.66% | 16.22 ms | 8.11 ms | 2 |
| `boost::variant2::detail::variant_base_impl` | 0.61% | 14.95 ms | 1.87 ms | 8 |
| `boost::variant2::detail::variant_storage_impl` | 0.5% | 12.2 ms | 1.53 ms | 8 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/max_size_type.h:59:5` | 0.49% | 11.98 ms | 5.99 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:875:5` | 0.47% | 11.48 ms | 5.74 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:870:5` | 0.46% | 11.3 ms | 5.65 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:865:5` | 0.46% | 11.27 ms | 5.64 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/string_view:879:5` | 0.46% | 11.27 ms | 5.64 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/system_error:556:3` | 0.43% | 10.68 ms | 5.34 ms | 2 |
| `_M_extract_float` | 0.42% | 10.36 ms | 5.18 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/max_size_type.h:440:5` | 0.39% | 9.68 ms | 4.84 ms | 2 |
| `stoi` | 0.39% | 9.58 ms | 2.4 ms | 4 |
| `boost::variant2::variant` | 0.37% | 9.05 ms | 4.53 ms | 2 |
| `boost::core::basic_string_view` | 0.35% | 8.71 ms | 4.36 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/error_condition.hpp:44:1` | 0.35% | 8.71 ms | 4.35 ms | 2 |
| `boost::system::error_condition` | 0.35% | 8.69 ms | 4.34 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4484:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.35% | 8.65 ms | 4.33 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/system_category_impl.hpp:56:1` | 0.33% | 8.19 ms | 4.09 ms | 2 |
| `boost::system::result` | 0.3% | 7.31 ms | 1.83 ms | 4 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/assert/include/boost/assert/source_location.hpp:26:1` | 0.29% | 7.17 ms | 3.58 ms | 2 |
| `boost::source_location` | 0.29% | 7.14 ms | 3.57 ms | 2 |
| `/usr/include/pthread.h:197:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 0.28% | 6.98 ms | 3.49 ms | 2 |
| `equivalent` | 0.28% | 6.97 ms | 1.74 ms | 4 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4490:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.28% | 6.89 ms | 3.45 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4495:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.27% | 6.74 ms | 3.37 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/ipv6_address.hpp:64:1` | 0.26% | 6.51 ms | 6.51 ms | 1 |
| `boost::urls::ipv6_address` | 0.26% | 6.49 ms | 6.49 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/hashtable_policy.h:614:3` | 0.25% | 6.15 ms | 3.08 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/grammar/string_token.hpp:139:1` | 0.22% | 5.4 ms | 2.7 ms | 2 |
| `boost::urls::string_token::implementation_defined::return_string` | 0.22% | 5.38 ms | 2.69 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4107:3` | 0.21% | 5.27 ms | 2.64 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/system_error:106:3` | 0.2% | 5.01 ms | 2.51 ms | 2 |
| `boost::mp11::detail::mp_with_index_impl_` | 0.2% | 4.92 ms | 703.14 µs | 7 |
| `to_string` | 0.19% | 4.76 ms | 1.59 ms | 3 |
| `_M_extract_int` | 0.19% | 4.73 ms | 2.37 ms | 2 |
| `/usr/include/stdio.h:29:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 0.19% | 4.58 ms | 2.29 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/system_error.hpp:20:1` | 0.18% | 4.47 ms | 2.23 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:275:3` | 0.18% | 4.43 ms | 2.21 ms | 2 |
| `boost::system::system_error` | 0.18% | 4.42 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4259:3` | 0.18% | 4.41 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/ios_base.h:233:3` | 0.18% | 4.41 ms | 2.21 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:381:3` | 0.18% | 4.4 ms | 2.2 ms | 2 |
| `boost::urls::string_token::implementation_defined::preserve_size_t` | 0.18% | 4.36 ms | 2.18 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4149:3` | 0.17% | 4.29 ms | 2.14 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/std_category_impl.hpp:29:1` | 0.17% | 4.11 ms | 2.05 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/emmintrin.h:4409:1` | 0.16% | 4.05 ms | 4.05 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:78:3` | 0.16% | 3.98 ms | 1.99 ms | 2 |
| `_mm_unpackhi_epi64` | 0.16% | 3.98 ms | 3.98 ms | 1 |
| `/usr/include/wchar.h:79:1 <Spelling=/usr/include/x86_64-linux-gnu/sys/cdefs.h:133:24>` | 0.16% | 3.9 ms | 1.95 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/compare:649:5` | 0.15% | 3.76 ms | 1.88 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/emmintrin.h:4472:1` | 0.14% | 3.43 ms | 3.43 ms | 1 |
| `__rotate` | 0.13% | 3.32 ms | 3.32 ms | 1 |
| `operator""h` | 0.13% | 3.3 ms | 1.1 ms | 3 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/cstddef:52:1` | 0.13% | 3.24 ms | 1.62 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/atomic_base.h:212:3` | 0.13% | 3.22 ms | 1.61 ms | 2 |
| `operator!=` | 0.12% | 3.01 ms | 753.25 µs | 4 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/system/include/boost/system/detail/std_category_impl.hpp:58:1` | 0.12% | 2.98 ms | 1.49 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/exception_ptr.h:50:1` | 0.12% | 2.93 ms | 1.47 ms | 2 |
| `operator==` | 0.12% | 2.88 ms | 719.75 µs | 4 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/chrono.h:1375:5` | 0.12% | 2.87 ms | 1.43 ms | 2 |
| `_mm_unpacklo_epi16` | 0.11% | 2.82 ms | 2.82 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/cpp_type_traits.h:67:1` | 0.11% | 2.77 ms | 1.38 ms | 2 |
| `/usr/lib/llvm-18/lib/clang/18/include/emmintrin.h:4443:1` | 0.11% | 2.71 ms | 2.71 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/stl_bvector.h:174:3` | 0.11% | 2.59 ms | 1.29 ms | 2 |
| `do_get` | 0.1% | 2.5 ms | 1.25 ms | 2 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/decode_view.hpp:87:1` | 0.1% | 2.44 ms | 2.44 ms | 1 |
| `boost::urls::decode_view` | 0.1% | 2.42 ms | 2.42 ms | 1 |
| `/mnt/c/Users/aland/Documents/Code/C++/boost/libs/url/include/boost/url/ipv4_address.hpp:53:1` | 0.1% | 2.38 ms | 2.38 ms | 1 |
| `boost::urls::ipv4_address` | 0.1% | 2.35 ms | 2.35 ms | 1 |
| `assume_aligned` | 0.09% | 2.25 ms | 1.13 ms | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/typeinfo:45:1` | 0.09% | 2.23 ms | 1.11 ms | 2 |
| `__countl_zero` | 0.09% | 2.16 ms | 1.08 ms | 2 |
| `_M_fill_insert` | 0.09% | 2.1 ms | 1.05 ms | 2 |
| `_mm_unpacklo_epi8` | 0.08% | 1.97 ms | 1.97 ms | 1 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/basic_string.h:4478:5 <Spelling=/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/x86_64-linux-gnu/c++/13/bits/c++config.h:146:33>` | 0.08% | 1.95 ms | 973.0 µs | 2 |
| `seekoff` | 0.08% | 1.89 ms | 947.0 µs | 2 |
| `/usr/bin/../lib/gcc/x86_64-linux-gnu/13/../../../../include/c++/13/bits/std_function.h:114:3` | 0.08% | 1.89 ms | 943.0 µs | 2 |


</details>

### Instantiate

Total Time: 246.03 ms

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost::system::result<boost::urls::authority_view>` | 13.88% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>` | 11.68% | 28.73 ms | 28.73 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned long, unsigned int>` | 4.04% | 9.94 ms | 4.97 ms | 2 |
| `boost::variant2::detail::variant_ma_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 3.34% | 8.21 ms | 8.21 ms | 1 |
| `boost::variant2::detail::variant_mc_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 2.91% | 7.17 ms | 7.17 ms | 1 |
| `boost::system::result<boost::urls::authority_view>::value<boost::urls::authority_view>` | 2.52% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<boost::urls::authority_view>::value` | 2.45% | 6.03 ms | 6.03 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[1]>` | 2.38% | 5.87 ms | 5.87 ms | 1 |


<details>
<summary>More...</summary>

| Symbol | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `boost::system::result<boost::urls::authority_view>` | 13.88% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>` | 11.68% | 28.73 ms | 28.73 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned long, unsigned int>` | 4.04% | 9.94 ms | 4.97 ms | 2 |
| `boost::variant2::detail::variant_ma_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 3.34% | 8.21 ms | 8.21 ms | 1 |
| `boost::variant2::detail::variant_mc_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 2.91% | 7.17 ms | 7.17 ms | 1 |
| `boost::system::result<boost::urls::authority_view>::value<boost::urls::authority_view>` | 2.52% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<boost::urls::authority_view>::value` | 2.45% | 6.03 ms | 6.03 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[1]>` | 2.38% | 5.87 ms | 5.87 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[2]>` | 1.92% | 4.72 ms | 4.72 ms | 1 |
| `boost::variant2::detail::variant_ca_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 1.9% | 4.66 ms | 4.66 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned short, int>` | 1.66% | 4.09 ms | 4.09 ms | 1 |
| `boost::variant2::detail::variant_cc_base_impl<true, false, boost::urls::authority_view, boost::system::error_code>` | 1.62% | 3.99 ms | 3.99 ms | 1 |
| `boost::core::basic_string_view<char>` | 1.48% | 3.64 ms | 1.82 ms | 2 |
| `boost::core::basic_string_view<char>::find_last_not_of` | 1.42% | 3.5 ms | 875.75 µs | 4 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[6]>` | 1.4% | 3.44 ms | 3.44 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[2]>` | 1.34% | 3.29 ms | 3.29 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[8]>` | 1.33% | 3.26 ms | 3.26 ms | 1 |
| `boost::mp11::detail::mp_count_impl<boost::mp11::mp_list<std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>>, std::integral_constant<bool, false>>` | 1.29% | 3.19 ms | 3.19 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[1]>` | 1.28% | 3.14 ms | 3.14 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[4]>` | 1.24% | 3.04 ms | 3.04 ms | 1 |
| `boost::core::basic_string_view<char>::find_first_of` | 1.22% | 3.0 ms | 751.25 µs | 4 |
| `boost::core::basic_string_view<char>::starts_with` | 1.19% | 2.93 ms | 1.47 ms | 2 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[3]>` | 1.19% | 2.92 ms | 2.92 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>` | 1.18% | 2.89 ms | 2.89 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[1]>` | 1.14% | 2.79 ms | 2.79 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_ne, const char *, std::nullptr_t>` | 1.11% | 2.74 ms | 2.74 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[4]>` | 1.09% | 2.68 ms | 2.68 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, bool, bool>` | 1.02% | 2.52 ms | 2.52 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[2]>` | 0.99% | 2.43 ms | 2.43 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[5]>` | 0.97% | 2.38 ms | 2.38 ms | 1 |
| `boost::throw_exception<std::out_of_range>` | 0.96% | 2.36 ms | 1.18 ms | 2 |
| `boost::mp11::detail::cx_count<std::integral_constant<bool, false>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>, std::integral_constant<bool, true>>` | 0.95% | 2.34 ms | 2.34 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, char[31]>` | 0.92% | 2.27 ms | 2.27 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[9]>` | 0.91% | 2.25 ms | 2.25 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, boost::core::basic_string_view<char>>` | 0.89% | 2.19 ms | 2.19 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::pct_string_view, char[1]>` | 0.89% | 2.19 ms | 2.19 ms | 1 |
| `boost::variant2::detail::variant_storage_impl<std::integral_constant<bool, false>, boost::variant2::detail::none, boost::urls::authority_view, boost::system::error_code>` | 0.88% | 2.17 ms | 2.17 ms | 1 |
| `boost::throw_with_location<std::system_error>` | 0.88% | 2.17 ms | 2.17 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, std::basic_string<char>, boost::core::basic_string_view<char>>` | 0.86% | 2.11 ms | 2.11 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_ne, boost::urls::decode_view::iterator, boost::urls::decode_view::iterator>` | 0.86% | 2.11 ms | 2.11 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, boost::core::basic_string_view<char>>` | 0.84% | 2.06 ms | 2.06 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::~variant_base_impl` | 0.84% | 2.06 ms | 2.06 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::urls::decode_view, char[6]>` | 0.83% | 2.03 ms | 2.03 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[3]>` | 0.8% | 1.97 ms | 1.97 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, unsigned long, unsigned long>` | 0.79% | 1.95 ms | 1.95 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[7]>` | 0.78% | 1.91 ms | 1.91 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::_destroy` | 0.77% | 1.9 ms | 1.9 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, char, char>` | 0.76% | 1.87 ms | 1.87 ms | 1 |
| `boost::throw_with_location<boost::system::system_error>` | 0.76% | 1.86 ms | 932.5 µs | 2 |
| `boost::core::basic_string_view<char>::find_last_of` | 0.75% | 1.86 ms | 928.5 µs | 2 |
| `boost::variant2::unsafe_get<1UL, boost::urls::authority_view, boost::system::error_code>` | 0.71% | 1.75 ms | 1.75 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, boost::core::basic_string_view<char>, char[6]>` | 0.68% | 1.67 ms | 1.67 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, int, int>` | 0.66% | 1.62 ms | 1.62 ms | 1 |
| `boost::variant2::detail::variant_storage_impl<std::integral_constant<bool, false>, boost::urls::authority_view, boost::system::error_code>` | 0.63% | 1.55 ms | 1.55 ms | 1 |
| `test_suite::detail::test_with_impl<test_suite::detail::lw_test_eq, const char *, const char *>` | 0.59% | 1.46 ms | 1.46 ms | 1 |
| `boost::core::basic_string_view<char>::find_first_not_of` | 0.59% | 1.45 ms | 725.0 µs | 2 |
| `boost::variant2::unsafe_get<0UL, boost::urls::authority_view, boost::system::error_code>` | 0.58% | 1.43 ms | 1.43 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::_get_impl<1UL>` | 0.54% | 1.34 ms | 1.34 ms | 1 |
| `boost::core::operator<<<char>` | 0.46% | 1.14 ms | 1.14 ms | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::_get_impl<0UL>` | 0.42% | 1.02 ms | 1.02 ms | 1 |
| `test_suite::detail::lw_test_eq::operator()<boost::urls::pct_string_view, char[6]>` | 0.36% | 877 µs | 877.0 µs | 1 |
| `boost::core::basic_string_view<char>::copy` | 0.35% | 855 µs | 855.0 µs | 1 |
| `test_suite::detail::lw_test_eq::operator()<boost::urls::pct_string_view, char[2]>` | 0.34% | 832 µs | 832.0 µs | 1 |
| `boost::urls::authority_view::userinfo<boost::urls::string_token::implementation_defined::return_string>` | 0.32% | 778 µs | 778.0 µs | 1 |
| `boost::variant2::detail::variant_storage_impl<std::integral_constant<bool, false>, boost::variant2::detail::none, boost::urls::authority_view, boost::system::error_code>::get<2UL>` | 0.31% | 764 µs | 764.0 µs | 1 |
| `boost::variant2::detail::variant_storage_impl<std::integral_constant<bool, true>, boost::system::error_code>` | 0.31% | 761 µs | 761.0 µs | 1 |
| `test_suite::detail::lw_test_eq::operator()<std::basic_string<char>, char[1]>` | 0.28% | 692 µs | 692.0 µs | 1 |
| `boost::throw_with_location<std::bad_exception>` | 0.27% | 663 µs | 663.0 µs | 1 |
| `boost::variant2::variant_alternative<0, boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>>` | 0.25% | 627 µs | 627.0 µs | 1 |
| `boost::mp11::mp_with_index<3UL, boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::_destroy_L1>` | 0.25% | 626 µs | 626.0 µs | 1 |
| `boost::core::detail::find_last_of<char>` | 0.25% | 603 µs | 603.0 µs | 1 |
| `boost::core::detail::find_first_of<char>` | 0.23% | 572 µs | 572.0 µs | 1 |
| `boost::wrapexcept<std::out_of_range>::wrapexcept` | 0.23% | 570 µs | 570.0 µs | 1 |
| `boost::variant2::detail::variant_base_impl<false, true, boost::urls::authority_view, boost::system::error_code>::_destroy_L1::operator()<std::integral_constant<unsigned long, 0>>` | 0.22% | 553 µs | 553.0 µs | 1 |
| `boost::urls::pct_string_view::decode<boost::urls::string_token::implementation_defined::return_string>` | 0.22% | 538 µs | 538.0 µs | 1 |
| `boost::variant2::variant_alternative<1, boost::variant2::variant<boost::urls::authority_view, boost::system::error_code>>` | 0.22% | 532 µs | 532.0 µs | 1 |
| `boost::core::detail::find_last_not_of<char>` | 0.22% | 532 µs | 532.0 µs | 1 |
| `boost::detail::with_throw_location<boost::system::system_error>::with_throw_location` | 0.22% | 530 µs | 530.0 µs | 1 |
| `boost::core::basic_string_view<char>::compare` | 0.2% | 502 µs | 502.0 µs | 1 |


</details>

### Instantiate Sets

Total Time: 246.03 ms

| Symbol Set | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `test_suite::detail::test_with_impl<$>` | 36.14% | 88.92 ms | 2.78 ms | 32 |
| `boost::system::result<$>` | 13.88% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<$>` | 11.68% | 28.73 ms | 28.73 ms | 1 |
| `boost::variant2::detail::variant_ma_base_impl<$>` | 3.34% | 8.21 ms | 8.21 ms | 1 |
| `boost::variant2::detail::variant_mc_base_impl<$>` | 2.91% | 7.17 ms | 7.17 ms | 1 |
| `boost::system::result<$>::value<$>` | 2.52% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<$>::value` | 2.45% | 6.03 ms | 6.03 ms | 1 |
| `boost::throw_with_location<$>` | 1.91% | 4.7 ms | 1.17 ms | 4 |


<details>
<summary>More...</summary>

| Symbol Set | %    | Total Time | Avg. | Count |
| --------- | ---------- | ---------- | ------------ | ----- |
| `test_suite::detail::test_with_impl<$>` | 36.14% | 88.92 ms | 2.78 ms | 32 |
| `boost::system::result<$>` | 13.88% | 34.16 ms | 34.16 ms | 1 |
| `boost::variant2::variant<$>` | 11.68% | 28.73 ms | 28.73 ms | 1 |
| `boost::variant2::detail::variant_ma_base_impl<$>` | 3.34% | 8.21 ms | 8.21 ms | 1 |
| `boost::variant2::detail::variant_mc_base_impl<$>` | 2.91% | 7.17 ms | 7.17 ms | 1 |
| `boost::system::result<$>::value<$>` | 2.52% | 6.21 ms | 6.21 ms | 1 |
| `boost::system::result<$>::value` | 2.45% | 6.03 ms | 6.03 ms | 1 |
| `boost::throw_with_location<$>` | 1.91% | 4.7 ms | 1.17 ms | 4 |
| `boost::variant2::detail::variant_ca_base_impl<$>` | 1.9% | 4.66 ms | 4.66 ms | 1 |
| `boost::variant2::detail::variant_storage_impl<$>` | 1.82% | 4.48 ms | 1.49 ms | 3 |
| `boost::variant2::detail::variant_cc_base_impl<$>` | 1.62% | 3.99 ms | 3.99 ms | 1 |
| `boost::core::basic_string_view<$>` | 1.48% | 3.64 ms | 1.82 ms | 2 |
| `boost::core::basic_string_view<$>::find_last_not_of` | 1.42% | 3.5 ms | 875.75 µs | 4 |
| `boost::mp11::detail::mp_count_impl<$>` | 1.29% | 3.19 ms | 3.19 ms | 1 |
| `boost::variant2::unsafe_get<$>` | 1.29% | 3.18 ms | 1.59 ms | 2 |
| `boost::core::basic_string_view<$>::find_first_of` | 1.22% | 3.0 ms | 751.25 µs | 4 |
| `boost::core::basic_string_view<$>::starts_with` | 1.19% | 2.93 ms | 1.47 ms | 2 |
| `boost::variant2::detail::variant_base_impl<$>` | 1.18% | 2.89 ms | 2.89 ms | 1 |
| `test_suite::detail::lw_test_eq::operator()<$>` | 0.98% | 2.4 ms | 800.33 µs | 3 |
| `boost::variant2::detail::variant_base_impl<$>::_get_impl<$>` | 0.96% | 2.36 ms | 1.18 ms | 2 |
| `boost::throw_exception<$>` | 0.96% | 2.36 ms | 1.18 ms | 2 |
| `boost::mp11::detail::cx_count<$>` | 0.95% | 2.34 ms | 2.34 ms | 1 |
| `boost::variant2::detail::variant_base_impl<$>::~variant_base_impl` | 0.84% | 2.06 ms | 2.06 ms | 1 |
| `boost::variant2::detail::variant_base_impl<$>::_destroy` | 0.77% | 1.9 ms | 1.9 ms | 1 |
| `boost::core::basic_string_view<$>::find_last_of` | 0.75% | 1.86 ms | 928.5 µs | 2 |
| `boost::core::basic_string_view<$>::find_first_not_of` | 0.59% | 1.45 ms | 725.0 µs | 2 |
| `boost::variant2::variant_alternative<$>` | 0.47% | 1.16 ms | 579.5 µs | 2 |
| `boost::core::operator<$` | 0.46% | 1.14 ms | 1.14 ms | 1 |
| `boost::core::basic_string_view<$>::copy` | 0.35% | 855 µs | 855.0 µs | 1 |
| `boost::urls::authority_view::userinfo<$>` | 0.32% | 778 µs | 778.0 µs | 1 |
| `boost::variant2::detail::variant_storage_impl<$>::get<$>` | 0.31% | 764 µs | 764.0 µs | 1 |
| `boost::mp11::mp_with_index<$>` | 0.25% | 626 µs | 626.0 µs | 1 |
| `boost::core::detail::find_last_of<$>` | 0.25% | 603 µs | 603.0 µs | 1 |
| `boost::core::detail::find_first_of<$>` | 0.23% | 572 µs | 572.0 µs | 1 |
| `boost::wrapexcept<$>::wrapexcept` | 0.23% | 570 µs | 570.0 µs | 1 |
| `boost::variant2::detail::variant_base_impl<$>::_destroy_L1::operator()<$>` | 0.22% | 553 µs | 553.0 µs | 1 |
| `boost::urls::pct_string_view::decode<$>` | 0.22% | 538 µs | 538.0 µs | 1 |
| `boost::core::detail::find_last_not_of<$>` | 0.22% | 532 µs | 532.0 µs | 1 |
| `boost::detail::with_throw_location<$>::with_throw_location` | 0.22% | 530 µs | 530.0 µs | 1 |
| `boost::core::basic_string_view<$>::compare` | 0.2% | 502 µs | 502.0 µs | 1 |


</details>

