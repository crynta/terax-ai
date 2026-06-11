#[cfg(feature = "openclicky")]
use terax_lib::modules::voice::tts::TtsProvider;

#[cfg(feature = "openclicky")]
#[test]
fn tts_provider_roundtrip() {
    assert!(matches!(
        TtsProvider::from_name("cartesia"),
        Ok(TtsProvider::Cartesia)
    ));
    assert_eq!(TtsProvider::Cartesia.name(), "cartesia");

    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        assert!(matches!(
            TtsProvider::from_name("avspeech"),
            Ok(TtsProvider::AvSpeech)
        ));
        assert_eq!(TtsProvider::AvSpeech.name(), "avspeech");
    }

    assert!(TtsProvider::from_name("unknown").is_err());
}
