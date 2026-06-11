use terax_lib::modules::overlay::drawing::AnnotationItem;

#[test]
fn annotation_item_serde_roundtrip() {
    let items = vec![
        AnnotationItem::Rect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
            color: "#FF0000".to_string(),
            stroke_width: 2.0,
        },
        AnnotationItem::Circle {
            cx: 200.0,
            cy: 150.0,
            radius: 30.0,
            color: "#00FF00".to_string(),
            stroke_width: 2.0,
        },
        AnnotationItem::Arrow {
            x1: 0.0,
            y1: 0.0,
            x2: 100.0,
            y2: 100.0,
            color: "#FF4444".to_string(),
            stroke_width: 2.0,
        },
        AnnotationItem::Text {
            x: 50.0,
            y: 50.0,
            content: "Hello".to_string(),
            font_size: 16.0,
            color: "#FF4444".to_string(),
        },
        AnnotationItem::Scribble {
            points: vec![(0.0, 0.0), (10.0, 10.0), (20.0, 5.0)],
            color: "#0000FF".to_string(),
            stroke_width: 3.0,
        },
    ];

    let json = serde_json::to_string(&items).expect("serialize");
    let decoded: Vec<AnnotationItem> = serde_json::from_str(&json).expect("deserialize");

    assert_eq!(items.len(), decoded.len());
}

#[test]
fn annotation_item_type_tag() {
    let rect = AnnotationItem::Rect {
        x: 0.0,
        y: 0.0,
        width: 10.0,
        height: 10.0,
        color: "#FF0000".to_string(),
        stroke_width: 1.0,
    };
    let json = serde_json::to_string(&rect).expect("serialize");
    assert!(json.contains("\"type\":\"rect\""));

    let arrow = AnnotationItem::Arrow {
        x1: 0.0,
        y1: 0.0,
        x2: 10.0,
        y2: 10.0,
        color: "#FF4444".to_string(),
        stroke_width: 2.0,
    };
    let json = serde_json::to_string(&arrow).expect("serialize");
    assert!(json.contains("\"type\":\"arrow\""));
}
