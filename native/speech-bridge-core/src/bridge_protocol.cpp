#include "bridge_protocol.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>

namespace terax::speech {
namespace {

constexpr std::array<char, 4> kRequestMagic{'T', 'R', 'X', 'Q'};
constexpr std::array<char, 4> kResponseMagic{'T', 'R', 'X', 'P'};
constexpr std::size_t kRequestHeaderSize = 20;

std::uint16_t read_u16(const std::uint8_t* data) {
    return static_cast<std::uint16_t>(data[0]) |
           static_cast<std::uint16_t>(data[1]) << 8;
}

std::uint32_t read_u32(const std::uint8_t* data) {
    return static_cast<std::uint32_t>(data[0]) |
           static_cast<std::uint32_t>(data[1]) << 8 |
           static_cast<std::uint32_t>(data[2]) << 16 |
           static_cast<std::uint32_t>(data[3]) << 24;
}

void append_u16(std::vector<std::uint8_t>& output, std::uint16_t value) {
    output.push_back(static_cast<std::uint8_t>(value));
    output.push_back(static_cast<std::uint8_t>(value >> 8));
}

void append_u32(std::vector<std::uint8_t>& output, std::uint32_t value) {
    output.push_back(static_cast<std::uint8_t>(value));
    output.push_back(static_cast<std::uint8_t>(value >> 8));
    output.push_back(static_cast<std::uint8_t>(value >> 16));
    output.push_back(static_cast<std::uint8_t>(value >> 24));
}

bool read_exact(std::istream& input, char* output, std::size_t size) {
    input.read(output, static_cast<std::streamsize>(size));
    return static_cast<std::size_t>(input.gcount()) == size;
}

}  // namespace

ReadResult read_request(std::istream& input, Request& request, std::string& error) {
    std::array<std::uint8_t, kRequestHeaderSize> header{};
    input.read(reinterpret_cast<char*>(header.data()),
               static_cast<std::streamsize>(header.size()));
    const auto read = static_cast<std::size_t>(input.gcount());
    if (read == 0 && input.eof()) return ReadResult::End;
    if (read != header.size()) {
        error = "truncated request header";
        return ReadResult::Error;
    }
    if (!std::equal(kRequestMagic.begin(), kRequestMagic.end(), header.begin())) {
        error = "invalid request magic";
        return ReadResult::Error;
    }
    if (read_u16(header.data() + 4) != kProtocolVersion) {
        error = "unsupported protocol version";
        return ReadResult::Error;
    }

    const auto operation = static_cast<Operation>(header[6]);
    if (operation != Operation::Transcribe && operation != Operation::Ping &&
        operation != Operation::Shutdown) {
        error = "invalid operation";
        return ReadResult::Error;
    }
    const auto profile = static_cast<Profile>(header[7]);
    if (profile != Profile::Nemotron && profile != Profile::Parakeet) {
        error = "invalid profile";
        return ReadResult::Error;
    }

    const auto sample_rate = read_u32(header.data() + 8);
    const auto language_size = static_cast<std::size_t>(read_u16(header.data() + 12));
    const auto reserved = read_u16(header.data() + 14);
    const auto sample_count = static_cast<std::size_t>(read_u32(header.data() + 16));
    if (reserved != 0) {
        error = "invalid reserved header field";
        return ReadResult::Error;
    }
    if (language_size > kMaxLanguageBytes) {
        error = "language tag is too long";
        return ReadResult::Error;
    }
    if (sample_count > kMaxSamples) {
        error = "audio payload is too large";
        return ReadResult::Error;
    }
    if (operation == Operation::Transcribe && sample_count == 0) {
        error = "audio payload is empty";
        return ReadResult::Error;
    }
    if (operation == Operation::Transcribe &&
        (sample_rate < 8000 || sample_rate > 96000)) {
        error = "invalid sample rate";
        return ReadResult::Error;
    }

    std::string language(language_size, '\0');
    if (language_size > 0 && !read_exact(input, language.data(), language_size)) {
        error = "truncated language tag";
        return ReadResult::Error;
    }
    if (!std::all_of(language.begin(), language.end(), [](unsigned char value) {
            return (value >= '0' && value <= '9') ||
                   (value >= 'A' && value <= 'Z') ||
                   (value >= 'a' && value <= 'z') ||
                   value == '-' || value == '_';
        })) {
        error = "invalid language tag";
        return ReadResult::Error;
    }

    if (sample_count > std::numeric_limits<std::size_t>::max() / sizeof(float)) {
        error = "audio payload is too large";
        return ReadResult::Error;
    }
    std::vector<std::uint8_t> bytes(sample_count * sizeof(float));
    if (!bytes.empty() &&
        !read_exact(input, reinterpret_cast<char*>(bytes.data()), bytes.size())) {
        error = "truncated audio payload";
        return ReadResult::Error;
    }
    std::vector<float> samples;
    samples.reserve(sample_count);
    for (std::size_t offset = 0; offset < bytes.size(); offset += 4) {
        const auto bits = read_u32(bytes.data() + offset);
        float sample = 0.0f;
        std::memcpy(&sample, &bits, sizeof(sample));
        if (!std::isfinite(sample)) {
            error = "audio payload contains a non-finite sample";
            return ReadResult::Error;
        }
        samples.push_back(sample);
    }

    request.operation = operation;
    request.profile = profile;
    request.sample_rate = sample_rate;
    request.language = std::move(language);
    request.samples = std::move(samples);
    return ReadResult::Ok;
}

bool write_response(
    std::ostream& output,
    Profile profile,
    bool success,
    const std::string& body) {
    auto length = std::min(body.size(), kMaxResponseBytes);
    while (length < body.size() && length > 0 &&
           (static_cast<unsigned char>(body[length]) & 0xc0) == 0x80) {
        --length;
    }
    std::vector<std::uint8_t> frame;
    frame.reserve(12 + length);
    frame.insert(frame.end(), kResponseMagic.begin(), kResponseMagic.end());
    append_u16(frame, kProtocolVersion);
    frame.push_back(success ? 0 : 1);
    frame.push_back(static_cast<std::uint8_t>(profile));
    append_u32(frame, static_cast<std::uint32_t>(length));
    frame.insert(frame.end(), body.begin(), body.begin() + static_cast<std::ptrdiff_t>(length));
    output.write(reinterpret_cast<const char*>(frame.data()),
                 static_cast<std::streamsize>(frame.size()));
    output.flush();
    return output.good();
}

}  // namespace terax::speech
