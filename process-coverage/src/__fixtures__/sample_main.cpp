// Sample source file with exclusion markers for testing
#include <iostream>

int main() {          // line 4
    int x = 42;       // line 5
    int y = 0;        // line 6

    if (x > 0) {      // line 8
        y = x * 2;    // line 9
    }

    // LCOV_EXCL_START
    std::cout << "debug: " << y << std::endl;  // line 13
    std::cout << "debug: " << x << std::endl;  // line 14
    // LCOV_EXCL_STOP

    return y; // LCOV_EXCL_LINE
}

int helper() {        // line 20
    return 0;         // line 21 GCOV_EXCL_LINE
}
