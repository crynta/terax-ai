use wasmparser::{Validator, WasmFeatures};

const SIMD: &[u8] = include_bytes!("../../packages/ghostty-core/adapted/ghostty-vt.wasm");
const SCALAR: &[u8] = include_bytes!("../../packages/ghostty-core/adapted/ghostty-vt-scalar.wasm");

#[test]
fn scalar_ghostty_validates_without_simd_instructions_or_types() {
    let features =
        WasmFeatures::default().difference(WasmFeatures::SIMD | WasmFeatures::RELAXED_SIMD);
    Validator::new_with_features(features)
        .validate_all(SCALAR)
        .unwrap();
    assert!(Validator::new_with_features(features)
        .validate_all(SIMD)
        .is_err());
}

#[test]
fn primary_ghostty_uses_only_standard_simd() {
    let features = WasmFeatures::default().difference(WasmFeatures::RELAXED_SIMD);
    Validator::new_with_features(features)
        .validate_all(SIMD)
        .unwrap();
}
