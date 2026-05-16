use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{command, State};

const EXEC_START: &str = "___TERAX_EXEC_START___";
const EXEC_END: &str = "___TERAX_EXEC_END___";
const EXEC_DONE: &str = "___TERAX_EXEC_DONE___";
const IMG_START: &str = "___TERAX_IMG_START___";
const IMG_END: &str = "___TERAX_IMG_END___";
const KERNEL_READY: &str = "___TERAX_KERNEL_READY___";

#[derive(Serialize, Debug)]
pub struct NotebookOutput {
    pub output_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<HashMap<String, String>>,
}

#[derive(Serialize, Debug)]
pub struct ExecResult {
    pub outputs: Vec<NotebookOutput>,
    pub execution_count: i32,
}

pub struct Kernel {
    child: Child,
    stdin: ChildStdin,
    stdout_reader: BufReader<std::process::ChildStdout>,
    execution_count: Mutex<i32>,
}

const KERNEL_SCRIPT: &str = r#"
import sys
import traceback
import ast
import io
import base64

globals_dict = {
    '__name__': '__main__',
    '__builtins__': __builtins__
}

# Silent matplotlib setup to prevent hanging on .show().
try:
    import matplotlib
    matplotlib.use('agg')
    import matplotlib.pyplot as plt
    globals_dict['plt'] = plt
    def _terax_show():
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight')
        buf.seek(0)
        img_str = base64.b64encode(buf.read()).decode('utf-8')
        print(f'___TERAX_IMG_START___{img_str}___TERAX_IMG_END___')
        plt.close()
    plt.show = _terax_show
except Exception:
    pass

print("___TERAX_KERNEL_READY___")
sys.stdout.flush()

def run_source(source):
    try:
        source = source.replace('\r\n', '\n')
        tree = ast.parse(source)
        if not tree.body:
            return
        
        last_node = tree.body[-1]
        
        # If the last node is an expression, we want to eval it to get the result repr
        if isinstance(last_node, ast.Expr):
            if len(tree.body) > 1:
                # Execute everything except the last line
                exec(compile(ast.Module(tree.body[:-1], type_ignores=[]), '<string>', 'exec'), globals_dict, globals_dict)
            
            # Evaluate the last line
            result = eval(compile(ast.Expression(last_node.value), '<string>', 'eval'), globals_dict, globals_dict)
            if result is not None:
                print(repr(result))
        else:
            # Just execute the whole thing
            exec(compile(tree, '<string>', 'exec'), globals_dict, globals_dict)
            
        # If the user has imported plt, check if there's an un-shown plot
        if 'plt' in globals_dict or 'matplotlib.pyplot' in sys.modules:
            import matplotlib.pyplot as plt
            if plt.get_fignums():
                plt.show()
                
    except Exception:
        traceback.print_exc(file=sys.stdout)

while True:
    line = sys.stdin.readline()
    if not line: break
    if line.strip() == "___TERAX_EXEC_START___":
        source_lines = []
        while True:
            l = sys.stdin.readline()
            if not l or l.strip() == "___TERAX_EXEC_END___": break
            source_lines.append(l)
        run_source("".join(source_lines))
        print("___TERAX_EXEC_DONE___")
        sys.stdout.flush()
"#;

fn stream_output(text: Vec<String>) -> NotebookOutput {
    NotebookOutput {
        output_type: "stream".to_string(),
        text: Some(text),
        name: Some("stdout".to_string()),
        data: None,
    }
}

fn image_output(b64: &str) -> NotebookOutput {
    NotebookOutput {
        output_type: "display_data".to_string(),
        text: None,
        name: None,
        data: Some(HashMap::from([(
            "image/png".to_string(),
            b64.to_string(),
        )])),
    }
}

fn python_command(program: &str, cwd: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.arg("-u")
        .arg("-c")
        .arg(KERNEL_SCRIPT)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

fn spawn_python(cwd: &Path) -> Result<Child, std::io::Error> {
    let mut cmd = python_command("python", cwd);

    #[cfg(windows)]
    {
        match cmd.spawn() {
            Ok(child) => Ok(child),
            Err(_) => python_command("py", cwd).spawn(),
        }
    }

    #[cfg(not(windows))]
    {
        cmd.spawn()
    }
}

impl Kernel {
    pub fn new(cwd: PathBuf) -> Result<Self, String> {
        let mut child = spawn_python(&cwd).map_err(|e| {
            format!(
                "Failed to start Python kernel: {}. Make sure Python is installed.",
                e
            )
        })?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        // Drain stderr in background
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for _ in reader.lines() {}
        });

        let mut stdout_reader = BufReader::new(stdout);

        // Wait for ready signal
        let mut ready_line = String::new();
        stdout_reader
            .read_line(&mut ready_line)
            .map_err(|e| e.to_string())?;
        if !ready_line.contains(KERNEL_READY) {
            return Err("Kernel failed to initialize".into());
        }

        Ok(Self {
            child,
            stdin,
            stdout_reader,
            execution_count: Mutex::new(0),
        })
    }

    pub fn execute(&mut self, source: &str) -> Result<ExecResult, String> {
        let mut count = self.execution_count.lock().unwrap();
        *count += 1;

        // Use our custom protocol
        let mut payload = format!("{EXEC_START}\n");
        payload.push_str(source);
        if !source.ends_with('\n') {
            payload.push('\n');
        }
        payload.push_str(EXEC_END);
        payload.push('\n');

        self.stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("Failed to write to kernel: {}", e))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Failed to flush kernel stdin: {}", e))?;

        let mut outputs = Vec::new();
        let mut stdout_text = Vec::new();

        loop {
            let mut line = String::new();
            match self.stdout_reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if line.contains(EXEC_DONE) {
                        break;
                    }

                    if line.contains(IMG_START) {
                        if let (Some(start), Some(end)) = (
                            line.find(IMG_START),
                            line.find(IMG_END),
                        ) {
                            let b64 = &line[start + IMG_START.len()..end];
                            outputs.push(image_output(b64));
                            continue;
                        }
                    }

                    stdout_text.push(line);
                }
                Err(e) => return Err(format!("Failed to read from kernel: {}", e)),
            }
        }

        if !stdout_text.is_empty() {
            outputs.push(stream_output(stdout_text));
        }

        Ok(ExecResult {
            outputs,
            execution_count: *count,
        })
    }
}

impl Drop for Kernel {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct KernelState {
    pub kernels: RwLock<HashMap<String, Arc<Mutex<Kernel>>>>,
}

impl Default for KernelState {
    fn default() -> Self {
        Self {
            kernels: RwLock::new(HashMap::new()),
        }
    }
}

#[command]
pub async fn notebook_exec_cell(
    state: State<'_, KernelState>,
    source: String,
    path: String,
) -> Result<ExecResult, String> {
    let notebook_path = path.clone();

    let mut kernels = state.kernels.write().unwrap();
    let kernel = if let Some(k) = kernels.get(&notebook_path) {
        k.clone()
    } else {
        let cwd = Path::new(&path)
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf();
        let k = Arc::new(Mutex::new(Kernel::new(cwd)?));
        kernels.insert(notebook_path, k.clone());
        k
    };
    drop(kernels); // Release write lock

    let mut k = kernel.lock().unwrap();
    k.execute(&source)
}
