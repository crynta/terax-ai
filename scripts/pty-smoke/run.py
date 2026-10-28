"""Run the real PTY transport inside the real Tauri webview (macOS debug build)."""
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
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path)
parser.add_argument("--idle-ms", type=int, default=35000)
parser.add_argument("--spin-seconds", type=int, default=5)
parser.add_argument("--skip-build", action="store_true")
parser.add_argument("--fast", action="store_true", help="skip the per-byte exactness scan so throughput is not bounded by the harness")
parser.add_argument("--dev", action="store_true", help="load the page from a Vite dev server (http origin) like `tauri dev`, using a separate cargo target dir")
parser.add_argument("--only", default="", help="comma list of scenarios: latency,spinners,flood,idle (default: all)")
parser.add_argument("--driver", default="driver-new.ts", help="driver-new.ts (multiplexed stream) or driver-old.ts (channels)")
parser.add_argument("--repo", type=Path, help="tree to build and run (default: this checkout)")
args = parser.parse_args()
if platform.system() != "Darwin":
    raise SystemExit("This smoke runner currently supports macOS only.")
root = Path(__file__).resolve().parent
repo = (args.repo or root.parent.parent).resolve()
output = (args.output or Path(tempfile.mkdtemp(prefix="terax-pty-smoke-"))).resolve()
output.mkdir(parents=True, exist_ok=True)
finished = threading.Event()
result = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        # The page the admission check loads in an iframe: another origin.
        served = {"/frame.html": "text/html", "/frame.js": "text/javascript"}
        name = self.path.split("#")[0].split("?")[0]
        if name not in served:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = (root / name[1:]).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", served[name])
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/report":
            result.update(json.loads(body))
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()
        if self.path == "/report":
            finished.set()


def check_gate(gate):
    """The stream scheme's refusals, measured in the real webview (multiplexed driver only)."""
    if gate is None:
        return
    foreign = gate["foreignOrigin"]
    expected = {
        "a valid request from the page succeeds": gate["positiveControl"] == 200,
        "a wrong token is 403": gate["wrongToken"] == [403],
        "an oversized body is 413": gate["oversized"] == 413,
        "a malformed body is 400": gate["malformed"] == 400,
        "a wrong method is 405": gate["wrongMethod"] == 405,
        "refusals from the page never reach the hub": gate["hubUntouchedByPageRefusals"],
        "a foreign origin holding a valid token gets no readable response": not foreign["anyReadable"],
        "a foreign origin never reaches the hub": foreign["hubUntouched"],
        "every foreign attempt was made": foreign["attempts"] == 10,
    }
    failed = [name for name, ok in expected.items() if not ok]
    if failed:
        raise RuntimeError(f"terax-pty admission checks failed: {failed}\n{json.dumps(gate, indent=2)}")
    print("terax-pty admission checks passed")


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
identifier = f"app.crynta.terax.pty-smoke-{uuid.uuid4().hex[:12]}"
real = json.loads((repo / "src-tauri/tauri.conf.json").read_text())
config = output / "tauri.conf.json"
dev_port = None
if args.dev:
    import socket
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    dev_port = probe.getsockname()[1]
    probe.close()
build_config = {"beforeBuildCommand": "", "frontendDist": str(output / "dist")}
if dev_port:
    build_config["devUrl"] = f"http://localhost:{dev_port}"
config.write_text(json.dumps({
    "productName": "Terax PTY Smoke", "identifier": identifier,
    "build": build_config,
    # The real CSP, so the custom scheme is checked against production policy.
    "app": {
        "security": {"csp": real["app"]["security"]["csp"]},
        "windows": [{"label": "main", "title": "Terax PTY Smoke", "width": 900, "height": 600, "visible": True}],
    },
    "bundle": {"active": False},
}))
env = {**os.environ,
       "TERAX_SMOKE_BASE_URL": f"http://127.0.0.1:{server.server_port}",
       "TERAX_SMOKE_DIST": str(output / "dist"),
       "TERAX_SMOKE_DRIVER": args.driver,
       "TERAX_SMOKE_ONLY": args.only,
       "TERAX_SMOKE_FAST": "1" if args.fast else "0",
       "TERAX_SMOKE_IDLE_MS": str(args.idle_ms),
       "TERAX_SMOKE_SPIN_SECONDS": str(args.spin_seconds)}
process = None
dev_server = None
try:
    with (output / "build.log").open("w") as log:
        if args.dev:
            # Like `tauri dev`: no embedded assets (no custom-protocol feature),
            # the window loads http://localhost:<port> from a Vite dev server.
            dev_env = {**env, "CARGO_TARGET_DIR": str(output / "cargo-target"),
                       "TAURI_CONFIG": config.read_text()}
            if not args.skip_build:
                subprocess.run(["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml"], cwd=repo, env=dev_env, stdout=log, stderr=log, check=True)
            dev_server = subprocess.Popen([str(repo / "node_modules/.bin/vite"), "--config", str(root / "vite.config.ts"), "--port", str(dev_port), "--strictPort", "--host", "localhost"], cwd=repo, env=env, stdout=log, stderr=log)
            import time
            for _ in range(100):
                try:
                    socket.create_connection(("localhost", dev_port), timeout=0.2).close()
                    break
                except OSError:
                    time.sleep(0.2)
            else:
                raise RuntimeError("Vite dev server did not start")
        else:
            subprocess.run([str(repo / "node_modules/.bin/vite"), "build", "--config", str(root / "vite.config.ts")], cwd=repo, env=env, stdout=log, stderr=log, check=True)
            if not args.skip_build:
                subprocess.run([str(repo / "node_modules/.bin/tauri"), "build", "--debug", "--no-bundle", "--config", str(config)], cwd=repo, env=env, stdout=log, stderr=log, check=True)
    metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--no-deps", "--format-version=1", "--manifest-path", "src-tauri/Cargo.toml"], cwd=repo))
    target = output / "cargo-target" if args.dev else Path(metadata["target_directory"])
    with (output / "app.log").open("w") as log:
        process = subprocess.Popen([str(target / "debug/terax")], cwd=repo, stdout=log, stderr=log)
        budget = 240 + args.idle_ms / 1000 + args.spin_seconds * 6
        if not finished.wait(budget):
            raise RuntimeError(f"PTY smoke timed out after {budget:.0f}s (see {output / 'app.log'})")
        process.wait(timeout=15)
    if "error" in result:
        raise RuntimeError(result)
    print(json.dumps(result, indent=2))
    check_gate(result.get("gate"))
finally:
    if process and process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    if dev_server and dev_server.poll() is None:
        dev_server.terminate()
        dev_server.wait(timeout=10)
    server.shutdown()
    (output / "result.json").write_text(json.dumps({"scope": "Real Tauri debug webview and login shell, local report server, isolated profile", **result}, indent=2) + "\n")
    profile = Path.home() / "Library/Application Support" / identifier
    if profile.exists():
        shutil.rmtree(profile)
print(f"Saved {output / 'result.json'}")
