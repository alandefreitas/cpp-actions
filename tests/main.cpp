#ifndef CPP_ACTIONS_NO_DEPS
#    include <boost/variant2.hpp>
#    include <fmt/format.h>
#endif
#include <cassert>
#include <string>

int
main() {
    std::string s;
#ifndef CPP_ACTIONS_NO_DEPS
    boost::variant2::variant<int, bool> v(2);
    if (v.index() == 0) {
        s = fmt::format("Hello, int!\n");
    } else {
        s = fmt::format("Hello, bool!\n");
    }
#else
    s = "Hello, int!\n";
#endif
    assert(s == "Hello, int!\n");
    return 0;
}
