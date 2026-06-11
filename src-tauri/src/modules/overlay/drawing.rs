use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum AnnotationItem {
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default = "default_color")]
        color: String,
        #[serde(default = "default_stroke")]
        stroke_width: f64,
    },
    Circle {
        cx: f64,
        cy: f64,
        radius: f64,
        #[serde(default = "default_color")]
        color: String,
        #[serde(default = "default_stroke")]
        stroke_width: f64,
    },
    Arrow {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        #[serde(default = "default_color")]
        color: String,
        #[serde(default = "default_stroke")]
        stroke_width: f64,
    },
    Text {
        x: f64,
        y: f64,
        content: String,
        #[serde(default = "default_font_size")]
        font_size: f64,
        #[serde(default = "default_color")]
        color: String,
    },
    Scribble {
        points: Vec<(f64, f64)>,
        #[serde(default = "default_color")]
        color: String,
        #[serde(default = "default_stroke")]
        stroke_width: f64,
    },
}

fn default_color() -> String {
    "#FF4444".to_string()
}

fn default_stroke() -> f64 {
    2.0
}

fn default_font_size() -> f64 {
    16.0
}
