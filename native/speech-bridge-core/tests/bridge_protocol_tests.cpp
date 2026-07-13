#include "bridge_protocol.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

void append_u16(std::string& output, std::uint16_t value) {
    output.push_back(static_cast<char>(value));
    output.push_back(static_cast<char>(value >> 8));
}

void append_u32(std::string& output, std::uint32_t value) {
    output.push_back(static_cast<char>(value));
    output.push_back(static_cast<char>(value >> 8));
    output.push_back(static_cast<char>(value >> 16));
    output.push_back(static_cast<char>(value >> 24));
}

std::string request_with_sample(float sample) {
    std::string frame = "TRXQ";
    append_u16(frame, 1);
    frame.push_back(static_cast<char>(terax::speech::Operation::Transcribe));
    frame.push_back(static_cast<char>(terax::speech::Profile::Nemotron));
    append_u32(frame, 16000);
    append_u16(frame, 5);
    append_u16(frame, 0);
    append_u32(frame, 1);
    frame.append("en-US");
    std::uint32_t bits = 0;
    std::memcpy(&bits, &sample, sizeof(bits));
    append_u32(frame, bits);
    return frame;
}

}  // namespace

int main() {
    {
        std::istringstream input(request_with_sample(0.25f));
        terax::speech::Request request;
        std::string error;
        require(terax::speech::read_request(input, request, error) ==
                    terax::speech::ReadResult::Ok,
                "valid request was rejected");
        require(request.operation == terax::speech::Operation::Transcribe,
                "operation did not round-trip");
        require(request.profile == terax::speech::Profile::Nemotron,
                "profile did not round-trip");
        require(request.sample_rate == 16000, "sample rate did not round-trip");
        require(request.language == "en-US", "language did not round-trip");
        require(request.samples.size() == 1, "sample count did not round-trip");
        require(request.samples[0] == 0.25f, "sample did not round-trip");
    }
    {
        std::istringstream input(request_with_sample(
            std::numeric_limits<float>::quiet_NaN()));
        terax::speech::Request request;
        std::string error;
        require(terax::speech::read_request(input, request, error) ==
                    terax::speech::ReadResult::Error,
                "non-finite sample was accepted");
        require(error.find("non-finite") != std::string::npos,
                "non-finite error was not reported");
    }
    {
        std::istringstream input("TRXQ");
        terax::speech::Request request;
        std::string error;
        require(terax::speech::read_request(input, request, error) ==
                    terax::speech::ReadResult::Error,
                "truncated request was accepted");
        require(error.find("truncated") != std::string::npos,
                "truncated request error was not reported");
    }
    {
        auto frame = request_with_sample(0.25f);
        frame[21] = ' ';
        std::istringstream input(frame);
        terax::speech::Request request;
        std::string error;
        require(terax::speech::read_request(input, request, error) ==
                    terax::speech::ReadResult::Error,
                "invalid language was accepted");
        require(error.find("language") != std::string::npos,
                "invalid language error was not reported");
    }
    {
        std::ostringstream output;
        require(terax::speech::write_response(
                    output, terax::speech::Profile::Parakeet, true, "hello"),
                "response write failed");
        const auto frame = output.str();
        require(frame.substr(0, 4) == "TRXP", "response magic is invalid");
        require(static_cast<unsigned char>(frame[6]) == 0,
                "response status is invalid");
        require(static_cast<unsigned char>(frame[7]) == 2,
                "response profile is invalid");
        require(frame.substr(12) == "hello", "response body is invalid");
    }
    {
        const std::string body(terax::speech::kMaxResponseBytes - 1, 'a');
        std::ostringstream output;
        require(terax::speech::write_response(
                    output, terax::speech::Profile::Nemotron, true,
                    body + "\xc3\xa9"),
                "bounded response write failed");
        const auto frame = output.str();
        require(frame.size() == 12 + terax::speech::kMaxResponseBytes - 1,
                "bounded response has the wrong size");
        require(frame.substr(12) == body,
                "bounded response split a UTF-8 sequence");
    }
    return 0;
}
