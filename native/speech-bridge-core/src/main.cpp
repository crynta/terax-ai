#include "bridge_protocol.h"

#include <speech_core/interfaces.h>
#include <speech_core/models/nemotron_multilingual_stt.h>
#include <speech_core/models/onnx_nemotron_streaming_stt.h>

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

using terax::speech::Profile;
using terax::speech::Request;

class ModelHost {
public:
    explicit ModelHost(std::filesystem::path model_root)
        : model_root_(std::move(model_root)) {}

    std::string transcribe(const Request& request) {
        load(request.profile);
        if (request.profile == Profile::Nemotron) {
            auto* model = static_cast<speech_core::NemotronMultilingualStt*>(model_.get());
            model->set_language(request.language.empty() ? "auto" : request.language);
        }
        const auto result = model_->transcribe(
            request.samples.data(), request.samples.size(),
            static_cast<int>(request.sample_rate));
        return result.text;
    }

private:
    void load(Profile profile) {
        if (model_ && profile_ == profile) return;
        model_.reset();
        const auto directory = model_root_ /
            (profile == Profile::Nemotron ? "nemotron" : "parakeet");
        if (profile == Profile::Nemotron) {
            model_ = std::make_unique<speech_core::NemotronMultilingualStt>(
                (directory / "encoder.onnx").string(),
                (directory / "decoder.onnx").string(),
                (directory / "joint.onnx").string(),
                (directory / "vocab.json").string(),
                (directory / "languages.json").string(),
                false);
        } else {
            model_ = std::make_unique<speech_core::OnnxNemotronStreamingStt>(
                (directory / "parakeet-eou-encoder.onnx").string(),
                (directory / "parakeet-eou-decoder.onnx").string(),
                (directory / "parakeet-eou-joint.onnx").string(),
                (directory / "vocab.json").string(),
                false);
        }
        profile_ = profile;
    }

    std::filesystem::path model_root_;
    Profile profile_ = Profile::Nemotron;
    std::unique_ptr<speech_core::STTInterface> model_;
};

std::filesystem::path model_root() {
    const char* value = std::getenv("TERAX_SPEECH_MODEL_DIR");
    if (value == nullptr || *value == '\0') {
        throw std::runtime_error("TERAX_SPEECH_MODEL_DIR is not set");
    }
    return std::filesystem::path(value);
}

}  // namespace

int main() {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    try {
        ModelHost host(model_root());
        while (true) {
            Request request;
            std::string error;
            const auto read = terax::speech::read_request(std::cin, request, error);
            if (read == terax::speech::ReadResult::End) return 0;
            if (read == terax::speech::ReadResult::Error) {
                terax::speech::write_response(
                    std::cout, Profile::Nemotron, false, error);
                return 2;
            }

            if (request.operation == terax::speech::Operation::Ping) {
                terax::speech::write_response(
                    std::cout, request.profile, true, "ready");
                continue;
            }
            if (request.operation == terax::speech::Operation::Shutdown) {
                terax::speech::write_response(
                    std::cout, request.profile, true, "bye");
                return 0;
            }
            try {
                const auto text = host.transcribe(request);
                terax::speech::write_response(
                    std::cout, request.profile, true, text);
            } catch (const std::exception& exception) {
                terax::speech::write_response(
                    std::cout, request.profile, false, exception.what());
            }
        }
    } catch (const std::exception& exception) {
        terax::speech::write_response(
            std::cout, Profile::Nemotron, false, exception.what());
        return 1;
    }
}
