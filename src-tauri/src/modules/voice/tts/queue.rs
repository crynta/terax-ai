use std::sync::Mutex;
use tokio::sync::mpsc;

pub enum TtsQueueMsg {
    Speak {
        text: String,
        provider: String,
    },
}

pub struct TtsQueue {
    rx: Mutex<mpsc::UnboundedReceiver<TtsQueueMsg>>,
    tx: mpsc::UnboundedSender<TtsQueueMsg>,
}

impl TtsQueue {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            tx,
            rx: Mutex::new(rx),
        }
    }

    pub fn enqueue(&self, text: String, provider: String) -> Result<(), String> {
        self.tx
            .send(TtsQueueMsg::Speak { text, provider })
            .map_err(|e| format!("queue send: {e}"))
    }

    pub fn try_next(&self) -> Option<TtsQueueMsg> {
        self.rx.lock().unwrap().try_recv().ok()
    }

    pub fn len(&self) -> usize {
        self.rx.lock().unwrap().len()
    }
}

impl Default for TtsQueue {
    fn default() -> Self {
        Self::new()
    }
}
