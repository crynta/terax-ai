use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures_util::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

use super::protocol::SpeechProfile;

const RELEASE_REPOSITORY: &str = "crynta/terax-ai";
const RUNTIME_ARCHIVE_LIMIT: u64 = 128 * 1024 * 1024;
const RUNTIME_EXPANDED_LIMIT: u64 = 256 * 1024 * 1024;
const MODEL_API_LIMIT: usize = 2 * 1024 * 1024;
const MODEL_DOWNLOAD_LIMIT: u64 = 1024 * 1024 * 1024;
const PROGRESS_INTERVAL_BYTES: u64 = 1024 * 1024;
const UPDATER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDNCQUJGRDhBQjYwRTM0NjkKUldScE5BNjJpdjJyT3dIN0dqbUpHaDA4QW1GaDVmTTllRXdZVk96dFNTRUZ3Y2hiVGszYjFqRloK";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeSpeechInstallEvent {
    Phase { label: String },
    Progress { downloaded: u64, total: u64 },
    Complete,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSpeechStatus {
    pub supported: bool,
    pub runtime_installed: bool,
    pub runtime_source: Option<String>,
    pub nemotron_installed: bool,
    pub parakeet_installed: bool,
}

pub struct NativeSpeechPaths {
    pub binary: PathBuf,
    pub runtime_dir: PathBuf,
    pub core_model_dir: PathBuf,
    pub swift_model_root: PathBuf,
}

struct RuntimeAsset {
    archive: &'static str,
    binary: &'static str,
}

struct ModelSpec {
    repository: &'static str,
    revision: &'static str,
    required: &'static [&'static str],
}

struct DownloadOptions<'a> {
    limit: u64,
    expected_size: Option<u64>,
    expected_sha256: Option<&'a str>,
    progress_base: u64,
    progress_total: Option<u64>,
    events: &'a Channel<NativeSpeechInstallEvent>,
}

#[derive(Deserialize)]
struct HfModel {
    sha: String,
    siblings: Vec<HfSibling>,
}

#[derive(Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
    lfs: Option<HfLfs>,
}

#[derive(Deserialize)]
struct HfLfs {
    sha256: String,
    size: u64,
}

pub fn status(app: &AppHandle) -> Result<NativeSpeechStatus, String> {
    let Some(asset) = runtime_asset() else {
        return Ok(NativeSpeechStatus {
            supported: false,
            runtime_installed: false,
            runtime_source: None,
            nemotron_installed: false,
            parakeet_installed: false,
        });
    };
    let cached = cached_runtime_paths(app, &asset)?;
    let dev = development_binary(&asset);
    let (runtime_installed, runtime_source) = if cached.binary.is_file() {
        (true, Some("managed".to_string()))
    } else if dev.as_ref().is_some_and(|path| path.is_file()) {
        (true, Some("development".to_string()))
    } else {
        (false, None)
    };
    Ok(NativeSpeechStatus {
        supported: true,
        runtime_installed,
        runtime_source,
        nemotron_installed: model_is_installed(app, SpeechProfile::Nemotron)?,
        parakeet_installed: model_is_installed(app, SpeechProfile::Parakeet)?,
    })
}

pub fn process_paths(app: &AppHandle) -> Result<NativeSpeechPaths, String> {
    let asset = runtime_asset().ok_or_else(unsupported_message)?;
    let mut paths = cached_runtime_paths(app, &asset)?;
    if !paths.binary.is_file() {
        if let Some(dev) = development_binary(&asset).filter(|path| path.is_file()) {
            paths.runtime_dir = dev
                .parent()
                .ok_or_else(|| "native speech development path has no parent".to_string())?
                .to_path_buf();
            paths.binary = dev;
        }
    }
    if !paths.binary.is_file() {
        return Err("native speech runtime is not installed".into());
    }
    Ok(paths)
}

pub async fn install(
    app: &AppHandle,
    profile: SpeechProfile,
    events: &Channel<NativeSpeechInstallEvent>,
) -> Result<NativeSpeechStatus, String> {
    let asset = runtime_asset().ok_or_else(unsupported_message)?;
    let paths = cached_runtime_paths(app, &asset)?;
    if !paths.binary.is_file() && development_binary(&asset).is_none_or(|path| !path.is_file()) {
        send_event(
            events,
            NativeSpeechInstallEvent::Phase {
                label: "Downloading native runtime".into(),
            },
        )?;
        install_runtime(app, &asset, events).await?;
    }
    if !model_is_installed(app, profile)? {
        send_event(
            events,
            NativeSpeechInstallEvent::Phase {
                label: format!("Downloading {} model", profile_label(profile)),
            },
        )?;
        install_model(app, profile, events).await?;
    }
    send_event(events, NativeSpeechInstallEvent::Complete)?;
    status(app)
}

fn send_event(
    events: &Channel<NativeSpeechInstallEvent>,
    event: NativeSpeechInstallEvent,
) -> Result<(), String> {
    events.send(event).map_err(|error| error.to_string())
}

fn runtime_asset() -> Option<RuntimeAsset> {
    if !runtime_os_supported() {
        return None;
    }
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(RuntimeAsset {
            archive: "terax-speech-bridge-macos-arm64.zip",
            binary: "terax-speech-bridge",
        }),
        ("linux", "x86_64") => Some(RuntimeAsset {
            archive: "terax-speech-bridge-linux-amd64.zip",
            binary: "terax-speech-bridge",
        }),
        ("windows", "x86_64") => Some(RuntimeAsset {
            archive: "terax-speech-bridge-windows-amd64.zip",
            binary: "terax-speech-bridge.exe",
        }),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn runtime_os_supported() -> bool {
    let mut info = std::mem::MaybeUninit::<libc::utsname>::uninit();
    if unsafe { libc::uname(info.as_mut_ptr()) } != 0 {
        return false;
    }
    let info = unsafe { info.assume_init() };
    let release = unsafe { std::ffi::CStr::from_ptr(info.release.as_ptr()) };
    release
        .to_string_lossy()
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 24)
}

#[cfg(not(target_os = "macos"))]
fn runtime_os_supported() -> bool {
    true
}

fn cached_runtime_paths(
    app: &AppHandle,
    asset: &RuntimeAsset,
) -> Result<NativeSpeechPaths, String> {
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let runtime_dir = data
        .join("speech")
        .join("runtime")
        .join(env!("CARGO_PKG_VERSION"));
    Ok(NativeSpeechPaths {
        binary: runtime_dir.join(asset.binary),
        runtime_dir,
        core_model_dir: cache.join("speech").join("core-models"),
        swift_model_root: cache.join("speech").join("models"),
    })
}

fn development_binary(asset: &RuntimeAsset) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
    if cfg!(target_os = "macos") {
        for configuration in ["release", "debug"] {
            let path = root
                .join("native/speech-bridge-macos/.build/arm64-apple-macosx")
                .join(configuration)
                .join(asset.binary);
            if path.is_file() {
                return Some(path);
            }
        }
    } else {
        for path in [
            root.join("native/speech-bridge-core/build")
                .join(asset.binary),
            root.join("native/speech-bridge-core/build/Release")
                .join(asset.binary),
        ] {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

async fn install_runtime(
    app: &AppHandle,
    asset: &RuntimeAsset,
    events: &Channel<NativeSpeechInstallEvent>,
) -> Result<(), String> {
    let paths = cached_runtime_paths(app, asset)?;
    let parent = paths
        .runtime_dir
        .parent()
        .ok_or_else(|| "native speech runtime path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let archive_file = tempfile::Builder::new()
        .prefix("terax-speech-runtime-")
        .suffix(".zip")
        .tempfile_in(parent)
        .map_err(|error| error.to_string())?;
    let version = env!("CARGO_PKG_VERSION");
    let base = format!("https://github.com/{RELEASE_REPOSITORY}/releases/download/v{version}");
    let client = download_client()?;
    download_file(
        &client,
        &format!("{base}/{}", asset.archive),
        archive_file.path(),
        DownloadOptions {
            limit: RUNTIME_ARCHIVE_LIMIT,
            expected_size: None,
            expected_sha256: None,
            progress_base: 0,
            progress_total: None,
            events,
        },
    )
    .await?;
    let signature =
        download_small(&client, &format!("{base}/{}.sig", asset.archive), 16 * 1024).await?;
    verify_runtime_signature(archive_file.path(), &signature)?;

    let staging = tempfile::Builder::new()
        .prefix("runtime-")
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    extract_runtime(archive_file.path(), staging.path())?;
    let binary = staging.path().join(asset.binary);
    if !binary.is_file() {
        return Err("signed native speech archive does not contain its runtime".into());
    }
    set_executable(&binary)?;
    std::fs::write(staging.path().join("version"), version).map_err(|error| error.to_string())?;
    let staging = staging.keep();
    replace_directory(staging, &paths.runtime_dir)
}

fn verify_runtime_signature(archive: &Path, encoded_signature: &[u8]) -> Result<(), String> {
    let public_key_text = BASE64_STANDARD
        .decode(UPDATER_PUBLIC_KEY)
        .map_err(|error| error.to_string())?;
    let public_key_text =
        std::str::from_utf8(&public_key_text).map_err(|error| error.to_string())?;
    let public_key = PublicKey::decode(public_key_text).map_err(|error| error.to_string())?;
    let encoded_signature = std::str::from_utf8(encoded_signature)
        .map_err(|error| error.to_string())?
        .trim();
    let signature_text = BASE64_STANDARD
        .decode(encoded_signature)
        .map_err(|error| error.to_string())?;
    let signature_text = std::str::from_utf8(&signature_text).map_err(|error| error.to_string())?;
    let signature = Signature::decode(signature_text).map_err(|error| error.to_string())?;
    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|error| error.to_string())?;
    let mut file = File::open(archive).map_err(|error| error.to_string())?;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        verifier.update(&chunk[..read]);
    }
    verifier.finalize().map_err(|error| error.to_string())
}

fn extract_runtime(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    if zip.len() > 512 {
        return Err("native speech archive contains too many entries".into());
    }
    let mut expanded = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| "native speech archive contains an unsafe path".to_string())?;
        validate_relative_path(&relative)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("native speech archive contains a symbolic link".into());
        }
        let declared_size = entry.size();
        let declared_total = expanded
            .checked_add(declared_size)
            .ok_or_else(|| "native speech archive is too large".to_string())?;
        if declared_total > RUNTIME_EXPANDED_LIMIT {
            return Err("native speech archive expands beyond 256 MiB".into());
        }
        let output = destination.join(relative);
        if entry.is_dir() {
            if declared_size != 0 {
                return Err("native speech archive directory has data".into());
            }
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut file = File::create(output).map_err(|error| error.to_string())?;
        let remaining = RUNTIME_EXPANDED_LIMIT - expanded;
        let copied = std::io::copy(&mut entry.by_ref().take(remaining + 1), &mut file)
            .map_err(|error| error.to_string())?;
        if copied > remaining || copied != declared_size {
            return Err("native speech archive entry size is invalid".into());
        }
        expanded += copied;
        file.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return Err("native speech archive contains an unsafe path".into());
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn model_spec(profile: SpeechProfile) -> ModelSpec {
    if cfg!(target_os = "macos") {
        match profile {
            SpeechProfile::Nemotron => ModelSpec {
                repository: "aufklarer/Nemotron-3.5-ASR-Streaming-0.6B-CoreML-INT8",
                revision: "447095fe87b480b5e6a15367f135303d479de8ac",
                required: &[
                    "config.json",
                    "decoder.mlmodelc/analytics/coremldata.bin",
                    "decoder.mlmodelc/coremldata.bin",
                    "decoder.mlmodelc/model.mil",
                    "decoder.mlmodelc/weights/weight.bin",
                    "encoder.mlmodelc/analytics/coremldata.bin",
                    "encoder.mlmodelc/coremldata.bin",
                    "encoder.mlmodelc/model.mil",
                    "encoder.mlmodelc/weights/weight.bin",
                    "joint.mlmodelc/analytics/coremldata.bin",
                    "joint.mlmodelc/coremldata.bin",
                    "joint.mlmodelc/model.mil",
                    "joint.mlmodelc/weights/weight.bin",
                    "languages.json",
                    "tokenizer.model",
                    "vocab.json",
                ],
            },
            SpeechProfile::Parakeet => ModelSpec {
                repository: "aufklarer/Parakeet-EOU-120M-CoreML-INT8",
                revision: "fca97346c39ef8cc046e7b13515972f6db48e2ee",
                required: &[
                    "config.json",
                    "decoder.mlmodelc/analytics/coremldata.bin",
                    "decoder.mlmodelc/coremldata.bin",
                    "decoder.mlmodelc/model.mil",
                    "decoder.mlmodelc/weights/weight.bin",
                    "encoder.mlmodelc/analytics/coremldata.bin",
                    "encoder.mlmodelc/coremldata.bin",
                    "encoder.mlmodelc/model.mil",
                    "encoder.mlmodelc/weights/weight.bin",
                    "joint.mlmodelc/analytics/coremldata.bin",
                    "joint.mlmodelc/coremldata.bin",
                    "joint.mlmodelc/model.mil",
                    "joint.mlmodelc/weights/weight.bin",
                    "vocab.json",
                ],
            },
        }
    } else {
        match profile {
            SpeechProfile::Nemotron => ModelSpec {
                repository: "soniqo/Nemotron-3.5-ASR-Streaming-Multilingual-0.6B-ONNX-INT8",
                revision: "1ce4daedd303e01d4e603634a72c28562f1a6855",
                required: &[
                    "config.json",
                    "encoder.onnx",
                    "decoder.onnx",
                    "decoder.onnx.data",
                    "joint.onnx",
                    "joint.onnx.data",
                    "languages.json",
                    "vocab.json",
                ],
            },
            SpeechProfile::Parakeet => ModelSpec {
                repository: "soniqo/Parakeet-EOU-120M-ONNX-INT8",
                revision: "d09ec62858af0f33506de73b1821599c6da3e0f3",
                required: &[
                    "config.json",
                    "parakeet-eou-encoder.onnx",
                    "parakeet-eou-decoder.onnx",
                    "parakeet-eou-joint.onnx",
                    "vocab.json",
                ],
            },
        }
    }
}

fn model_directory(app: &AppHandle, profile: SpeechProfile) -> Result<PathBuf, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    let spec = model_spec(profile);
    if cfg!(target_os = "macos") {
        Ok(cache.join("speech/models").join(spec.repository))
    } else {
        Ok(cache.join("speech/core-models").join(profile.id()))
    }
}

fn model_is_installed(app: &AppHandle, profile: SpeechProfile) -> Result<bool, String> {
    let spec = model_spec(profile);
    let directory = model_directory(app, profile)?;
    let marker = directory.join(".terax-revision");
    if std::fs::read_to_string(marker)
        .ok()
        .is_none_or(|revision| revision.trim() != spec.revision)
    {
        return Ok(false);
    }
    Ok(spec
        .required
        .iter()
        .all(|path| directory.join(path).is_file()))
}

async fn install_model(
    app: &AppHandle,
    profile: SpeechProfile,
    events: &Channel<NativeSpeechInstallEvent>,
) -> Result<(), String> {
    let spec = model_spec(profile);
    let endpoint = format!(
        "https://huggingface.co/api/models/{}/revision/{}?blobs=true",
        spec.repository, spec.revision
    );
    let client = download_client()?;
    let metadata = download_small(&client, &endpoint, MODEL_API_LIMIT).await?;
    let model: HfModel = serde_json::from_slice(&metadata).map_err(|error| error.to_string())?;
    if model.sha != spec.revision {
        return Err("model registry returned an unexpected revision".into());
    }
    let mut files = model
        .siblings
        .into_iter()
        .filter(|file| file.rfilename != ".gitattributes")
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.rfilename.cmp(&right.rfilename));
    for required in spec.required {
        if !files.iter().any(|file| file.rfilename == *required) {
            return Err(format!("model snapshot is missing {required}"));
        }
    }
    let total = files.iter().try_fold(0u64, |total, file| {
        let size = file.lfs.as_ref().map_or(file.size, |lfs| Some(lfs.size));
        total
            .checked_add(size.ok_or_else(|| {
                format!(
                    "model registry did not report a size for {}",
                    file.rfilename
                )
            })?)
            .ok_or_else(|| "model snapshot is too large".to_string())
    })?;
    if total > MODEL_DOWNLOAD_LIMIT {
        return Err("native speech model exceeds the 1 GiB download limit".into());
    }

    let target = model_directory(app, profile)?;
    let parent = target
        .parent()
        .ok_or_else(|| "native speech model path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = tempfile::Builder::new()
        .prefix(&format!("{}-", profile.id()))
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    let mut downloaded = 0u64;
    for file in files {
        let relative = PathBuf::from(&file.rfilename);
        validate_relative_path(&relative)?;
        let output = staging.path().join(&relative);
        if let Some(parent) = output.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| error.to_string())?;
        }
        let expected_size = file.lfs.as_ref().map_or(file.size, |lfs| Some(lfs.size));
        let expected_hash = file.lfs.as_ref().map(|lfs| lfs.sha256.as_str());
        let url = model_file_url(&spec, &relative)?;
        downloaded += download_file(
            &client,
            url.as_str(),
            &output,
            DownloadOptions {
                limit: expected_size.unwrap_or(MODEL_DOWNLOAD_LIMIT),
                expected_size,
                expected_sha256: expected_hash,
                progress_base: downloaded,
                progress_total: Some(total),
                events,
            },
        )
        .await?;
    }
    tokio::fs::write(staging.path().join(".terax-revision"), spec.revision)
        .await
        .map_err(|error| error.to_string())?;
    let staging = staging.keep();
    replace_directory(staging, &target)
}

fn replace_directory(staging: PathBuf, target: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(target).is_err() {
        return std::fs::rename(staging, target).map_err(|error| error.to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "installation target has no parent".to_string())?;
    let backup_dir = tempfile::Builder::new()
        .prefix("previous-")
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    let backup = backup_dir.path().to_path_buf();
    backup_dir.close().map_err(|error| error.to_string())?;
    std::fs::rename(target, &backup).map_err(|error| error.to_string())?;
    if let Err(install_error) = std::fs::rename(&staging, target) {
        return match std::fs::rename(&backup, target) {
            Ok(()) => Err(install_error.to_string()),
            Err(rollback_error) => Err(format!(
                "installation failed ({install_error}) and the previous installation could not be restored ({rollback_error})"
            )),
        };
    }
    if let Err(error) = remove_path(&backup) {
        log::warn!("could not remove previous native speech installation: {error}");
    }
    Ok(())
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path)?.file_type().is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

fn model_file_url(spec: &ModelSpec, path: &Path) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&format!(
        "https://huggingface.co/{}/resolve/{}/",
        spec.repository, spec.revision
    ))
    .map_err(|error| error.to_string())?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "model download URL cannot contain path segments".to_string())?;
    segments.pop_if_empty();
    for component in path.components() {
        let Component::Normal(component) = component else {
            return Err("model snapshot contains an unsafe path".into());
        };
        let component = component
            .to_str()
            .ok_or_else(|| "model snapshot path is not UTF-8".to_string())?;
        segments.push(component);
    }
    drop(segments);
    Ok(url)
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    output: &Path,
    options: DownloadOptions<'_>,
) -> Result<u64, String> {
    let DownloadOptions {
        limit,
        expected_size,
        expected_sha256,
        progress_base,
        progress_total,
        events,
    } = options;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed with HTTP {}", response.status()));
    }
    let content_length = response.content_length();
    if content_length.is_some_and(|size| size > limit) {
        return Err("download is larger than its allowed limit".into());
    }
    if let (Some(actual), Some(expected)) = (content_length, expected_size) {
        if actual != expected {
            return Err("download size does not match model metadata".into());
        }
    }
    let event_total = progress_total.or(content_length).unwrap_or(limit);
    let mut file = tokio::fs::File::create(output)
        .await
        .map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    let mut size = 0u64;
    let mut last_reported = 0u64;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        size = size
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "download size overflowed".to_string())?;
        if size > limit {
            return Err("download is larger than its allowed limit".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        if size.saturating_sub(last_reported) >= PROGRESS_INTERVAL_BYTES {
            send_progress(events, progress_base, size, event_total)?;
            last_reported = size;
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    if last_reported != size {
        send_progress(events, progress_base, size, event_total)?;
    }
    if expected_size.is_some_and(|expected| expected != size) {
        return Err("download size does not match model metadata".into());
    }
    if let Some(expected) = expected_sha256 {
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            return Err("downloaded model file failed SHA-256 verification".into());
        }
    }
    Ok(size)
}

fn send_progress(
    events: &Channel<NativeSpeechInstallEvent>,
    base: u64,
    current: u64,
    total: u64,
) -> Result<(), String> {
    let downloaded = base
        .checked_add(current)
        .ok_or_else(|| "download progress overflowed".to_string())?;
    send_event(
        events,
        NativeSpeechInstallEvent::Progress { downloaded, total },
    )
}

async fn download_small(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed with HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("downloaded metadata is too large".into());
    }
    let mut output = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if output.len().saturating_add(chunk.len()) > limit {
            return Err("downloaded metadata is too large".into());
        }
        output.extend_from_slice(&chunk);
    }
    Ok(output)
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent(concat!("Terax/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
}

fn profile_label(profile: SpeechProfile) -> &'static str {
    match profile {
        SpeechProfile::Nemotron => "Nemotron",
        SpeechProfile::Parakeet => "Parakeet low-memory",
    }
}

fn unsupported_message() -> String {
    "native speech is available on Apple silicon macOS 15 or newer and x86-64 Linux or Windows"
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn runtime_archive_paths_reject_traversal() {
        assert!(validate_relative_path(Path::new("bin/bridge")).is_ok());
        assert!(validate_relative_path(Path::new("../bridge")).is_err());
        assert!(validate_relative_path(Path::new("/bridge")).is_err());
    }

    #[test]
    fn runtime_extraction_rejects_traversal_entries() {
        let temporary = tempfile::tempdir().unwrap();
        let archive = temporary.path().join("runtime.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        writer
            .start_file("../escape", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"no").unwrap();
        writer.finish().unwrap();

        assert!(extract_runtime(&archive, temporary.path()).is_err());
        assert!(!temporary.path().join("escape").exists());
    }

    #[test]
    fn runtime_extraction_rejects_symbolic_links() {
        let temporary = tempfile::tempdir().unwrap();
        let archive = temporary.path().join("runtime.zip");
        let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
        writer
            .add_symlink("bridge-link", "target", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap();

        assert!(extract_runtime(&archive, temporary.path()).is_err());
        assert!(!temporary.path().join("bridge-link").exists());
    }

    #[test]
    fn model_specs_are_revision_pinned() {
        for profile in [SpeechProfile::Nemotron, SpeechProfile::Parakeet] {
            let spec = model_spec(profile);
            assert_eq!(spec.revision.len(), 40);
            assert!(spec.revision.bytes().all(|byte| byte.is_ascii_hexdigit()));
            assert!(!spec.required.is_empty());
        }
    }

    #[test]
    fn model_file_urls_encode_each_path_segment() {
        let spec = model_spec(SpeechProfile::Parakeet);
        let url = model_file_url(&spec, Path::new("weights/a b#c.onnx")).unwrap();
        assert!(url.as_str().ends_with("weights/a%20b%23c.onnx"));
    }

    #[test]
    fn directory_replacement_preserves_the_new_tree() {
        let temporary = tempfile::tempdir().unwrap();
        let target = temporary.path().join("target");
        let staging = temporary.path().join("staging");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(target.join("old"), b"old").unwrap();
        std::fs::write(staging.join("new"), b"new").unwrap();

        replace_directory(staging, &target).unwrap();

        assert!(!target.join("old").exists());
        assert_eq!(std::fs::read(target.join("new")).unwrap(), b"new");
    }

    #[test]
    fn directory_replacement_restores_the_previous_tree_on_failure() {
        let temporary = tempfile::tempdir().unwrap();
        let target = temporary.path().join("target");
        let missing_staging = temporary.path().join("missing-staging");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("old"), b"old").unwrap();

        assert!(replace_directory(missing_staging, &target).is_err());

        assert_eq!(std::fs::read(target.join("old")).unwrap(), b"old");
    }

    #[test]
    fn runtime_signature_key_matches_the_updater_key() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
        assert_eq!(
            config["plugins"]["updater"]["pubkey"].as_str(),
            Some(UPDATER_PUBLIC_KEY)
        );
    }
}
