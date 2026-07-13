cmake_minimum_required(VERSION 3.20)
project(terax_speech_bridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(TERAX_SPEECH_BRIDGE_RUNTIME "Build the speech runtime executable" ON)

add_library(terax_speech_bridge_protocol STATIC
    src/bridge_protocol.cpp
)
target_include_directories(terax_speech_bridge_protocol PUBLIC src)

enable_testing()
add_executable(terax_speech_bridge_protocol_tests
    tests/bridge_protocol_tests.cpp
)
target_link_libraries(terax_speech_bridge_protocol_tests
    PRIVATE terax_speech_bridge_protocol
)
add_test(
    NAME terax_speech_bridge_protocol
    COMMAND terax_speech_bridge_protocol_tests
)

if(TERAX_SPEECH_BRIDGE_RUNTIME)
    if(NOT DEFINED SPEECH_CORE_SOURCE_DIR)
        message(FATAL_ERROR "SPEECH_CORE_SOURCE_DIR is required")
    endif()
    if(NOT DEFINED ORT_DIR)
        message(FATAL_ERROR "ORT_DIR is required")
    endif()

    set(SPEECH_CORE_WITH_ONNX ON CACHE BOOL "" FORCE)
    set(SPEECH_CORE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(SPEECH_CORE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    add_subdirectory(
        "${SPEECH_CORE_SOURCE_DIR}"
        "${CMAKE_CURRENT_BINARY_DIR}/speech-core"
        EXCLUDE_FROM_ALL
    )

    add_executable(terax-speech-bridge src/main.cpp)
    target_link_libraries(terax-speech-bridge
        PRIVATE terax_speech_bridge_protocol speech_core_models
    )
    if(UNIX AND NOT APPLE)
        set_target_properties(terax-speech-bridge PROPERTIES
            BUILD_RPATH "$ORIGIN"
            INSTALL_RPATH "$ORIGIN"
        )
    endif()
endif()
