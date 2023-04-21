#include <boost/variant2.hpp>
#include <fmt/format.h>
#include <cassert>

int
main() {
    boost::variant2::variant<int, bool> v(2);
    std::string s;
    if (v.index() == 0) {
        s = fmt::format("Hello, int!\n");
    } else {
        s = fmt::format("Hello, bool!\n");
    }
    assert(s == "Hello, int!\n");
    return 0;
}
