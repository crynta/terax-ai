"""Exercise the real Tauri IPC transport with a local fixture and isolated profile."""
import argparse
import http.server
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path)
args = parser.parse_args()
if platform.system() != "Darwin":
    raise SystemExit("This smoke runner currently supports macOS only.")
root = Path(__file__).resolve().parent
repo = root.parent.parent
output = (args.output or Path(tempfile.mkdtemp(prefix="terax-ipc-profile-"))).resolve()
output.mkdir(parents=True, exist_ok=True)
finished = threading.Event()
state = {"slowDisconnected": False}
result = {}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/report":
            result.update(json.loads(body))
            result.update(state)
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        if self.path == "/report":
            finished.set()
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        if self.path == "/bulk":
            self.wfile.write(b"ABCD" * (256 * 1024))
            self.wfile.flush()
        elif self.path == "/sse":
            for i in range(400):
                self.wfile.write(f"data: {i}\n\n".encode())
                self.wfile.flush()
                if i % 20 == 0:
                    time.sleep(0.005)
        elif self.path == "/slow":
            try:
                for _ in range(1000):
                    self.wfile.write(b"hello\n")
                    self.wfile.flush()
                    time.sleep(0.02)
            except (BrokenPipeError, ConnectionResetError):
                state["slowDisconnected"] = True

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
identifier = f"app.crynta.terax.ipc-lab-{uuid.uuid4().hex[:12]}"
config = output / "tauri.conf.json"
config.write_text(json.dumps({
    "productName": "Terax IPC Lab", "identifier": identifier,
    "build": {"beforeBuildCommand": "", "frontendDist": str(output / "dist")},
    "app": {"windows": [{"label": "main", "title": "Terax IPC Lab", "width": 800, "height": 500, "visible": True}]},
    "bundle": {"active": False},
}))
tree = output / "tree"
for d in range(80):
    folder = tree / f"d{d:02}"
    folder.mkdir(parents=True, exist_ok=True)
    for f in range(100):
        (folder / f"f{f:03}.txt").write_text("".join(f"line {i} of file {f}\n" for i in range(40)))
env = {**os.environ, "TERAX_IPC_BASE_URL": f"http://127.0.0.1:{server.server_port}", "TERAX_IPC_DIST": str(output / "dist"), "TERAX_IPC_TREE": str(tree.resolve())}
process = None
try:
    with (output / "build.log").open("w") as log:
        subprocess.run(["pnpm", "exec", "vite", "build", "--config", str(root / "vite.config.ts")], cwd=repo, env=env, stdout=log, stderr=log, check=True)
        subprocess.run(["pnpm", "build:cli:dev"], cwd=repo, env=env, stdout=log, stderr=log, check=True)
        subprocess.run(["pnpm", "exec", "tauri", "build", "--debug", "--no-bundle", "--config", str(config)], cwd=repo, env=env, stdout=log, stderr=log, check=True)
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--no-deps", "--format-version=1", "--manifest-path", "src-tauri/Cargo.toml"], cwd=repo))
    with (output / "app.log").open("w") as log:
        process = subprocess.Popen([str(Path(metadata["target_directory"]) / "debug/terax")], cwd=repo, stdout=log, stderr=log)
        if not finished.wait(45):
            raise RuntimeError("Native IPC test timed out")
        process.wait(timeout=10)
    expected = {"rawBody", "boundedConsumer", "smallChunks", "abort", "stored", "bigSession", "deleted", "slowDisconnected", "mainThreadResponsive", "grepSuperseded", "searchCached", "searchSeesNewFile", "watchDirectory", "watchFile", "watchQuietOutside", "backdropToggle"}
    if any(result.get(key) is not True for key in expected):
        raise RuntimeError(result)
    print(json.dumps(result))
finally:
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    server.shutdown()
    (output / "result.json").write_text(json.dumps({"scope": "Real Tauri debug webview, local synthetic HTTP, isolated conversation storage", **result}, indent=2) + "\n")
    profile = Path.home() / "Library/Application Support" / identifier
    if profile.exists():
        shutil.rmtree(profile)
print(f"Saved {output / 'result.json'}")
