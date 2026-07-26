#pragma once

#include <cstdint>
#include <istream>
#include <ostream>
#include <string>
#include <vector>

namespace terax::speech {

constexpr std::uint16_t kProtocolVersion = 1;
constexpr std::size_t kMaxSamples = 8 * 1024 * 1024;
constexpr std::size_t kMaxLanguageBytes = 64;
constexpr std::size_t kMaxResponseBytes = 1024 * 1024;

enum class Operation : std::uint8_t {
    Transcribe = 1,
    Ping = 2,
    Shutdown = 3,
};

enum class Profile : std::uint8_t {
    Nemotron = 1,
    Parakeet = 2,
};

struct Request {
    Operation operation = Operation::Ping;
    Profile profile = Profile::Nemotron;
    std::uint32_t sample_rate = 0;
    std::string language;
    std::vector<float> samples;
};

enum class ReadResult {
    Ok,
    End,
    Error,
};

ReadResult read_request(std::istream& input, Request& request, std::string& error);
bool write_response(
    std::ostream& output,
    Profile profile,
    bool success,
    const std::string& body);

}  // namespace terax::speech
