use arrow::array::*;
use arrow::datatypes::{DataType, TimeUnit};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde::Serialize;
use std::fs::File;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

#[derive(Serialize)]
pub struct ParquetColumn {
    pub name: String,
    pub dtype: String,
}

#[derive(Serialize)]
pub struct ParquetResult {
    pub columns: Vec<ParquetColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: usize,
}

fn array_value_to_json(array: &dyn Array, index: usize) -> serde_json::Value {
    if array.is_null(index) {
        return serde_json::Value::Null;
    }
    match array.data_type() {
        DataType::Boolean => {
            let a = array.as_any().downcast_ref::<BooleanArray>().unwrap();
            serde_json::Value::Bool(a.value(index))
        }
        DataType::Int8 => {
            let a = array.as_any().downcast_ref::<Int8Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Int16 => {
            let a = array.as_any().downcast_ref::<Int16Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Int32 => {
            let a = array.as_any().downcast_ref::<Int32Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Int64 => {
            let a = array.as_any().downcast_ref::<Int64Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::UInt8 => {
            let a = array.as_any().downcast_ref::<UInt8Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::UInt16 => {
            let a = array.as_any().downcast_ref::<UInt16Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::UInt32 => {
            let a = array.as_any().downcast_ref::<UInt32Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::UInt64 => {
            let a = array.as_any().downcast_ref::<UInt64Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Float32 => {
            let a = array.as_any().downcast_ref::<Float32Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Float64 => {
            let a = array.as_any().downcast_ref::<Float64Array>().unwrap();
            serde_json::json!(a.value(index))
        }
        DataType::Utf8 => {
            let a = array.as_any().downcast_ref::<StringArray>().unwrap();
            serde_json::Value::String(a.value(index).to_string())
        }
        DataType::Timestamp(TimeUnit::Second, _) => {
            let a = array.as_any().downcast_ref::<TimestampSecondArray>().unwrap();
            if let Some(val) = a.value_as_datetime(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Timestamp(TimeUnit::Millisecond, _) => {
            let a = array.as_any().downcast_ref::<TimestampMillisecondArray>().unwrap();
            if let Some(val) = a.value_as_datetime(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Timestamp(TimeUnit::Microsecond, _) => {
            let a = array.as_any().downcast_ref::<TimestampMicrosecondArray>().unwrap();
            if let Some(val) = a.value_as_datetime(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Timestamp(TimeUnit::Nanosecond, _) => {
            let a = array.as_any().downcast_ref::<TimestampNanosecondArray>().unwrap();
            if let Some(val) = a.value_as_datetime(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Date32 => {
            let a = array.as_any().downcast_ref::<Date32Array>().unwrap();
            if let Some(val) = a.value_as_date(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Date64 => {
            let a = array.as_any().downcast_ref::<Date64Array>().unwrap();
            if let Some(val) = a.value_as_date(index) {
                serde_json::Value::String(val.to_string())
            } else {
                serde_json::Value::Null
            }
        }
        DataType::Decimal128(_, _) => {
            let a = array.as_any().downcast_ref::<Decimal128Array>().unwrap();
            serde_json::Value::String(a.value_as_string(index))
        }
        DataType::Decimal256(_, _) => {
            let a = array.as_any().downcast_ref::<Decimal256Array>().unwrap();
            serde_json::Value::String(a.value_as_string(index))
        }
        _ => {
            // Fallback: unsupported type
            serde_json::Value::String(format!("<unsupported type: {}>", array.data_type()))
        }
    }
}

#[tauri::command]
pub fn fs_read_parquet(path: String, workspace: Option<WorkspaceEnv>) -> Result<ParquetResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let file = File::open(&p).map_err(|e| e.to_string())?;

    let builder = ParquetRecordBatchReaderBuilder::try_new(file).map_err(|e| e.to_string())?;
    let total_rows = builder.metadata().file_metadata().num_rows() as usize;
    let schema = builder.schema().clone();

    let columns: Vec<ParquetColumn> = schema
        .fields()
        .iter()
        .map(|f| ParquetColumn {
            name: f.name().clone(),
            dtype: format!("{}", f.data_type()),
        })
        .collect();

    // Read up to 10k rows
    let reader = builder
        .with_batch_size(1024)
        .build()
        .map_err(|e| e.to_string())?;

    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let max_rows = 10_000;

    for batch_result in reader {
        let batch = batch_result.map_err(|e| e.to_string())?;
        let n = batch.num_rows().min(max_rows - rows.len());
        for row_idx in 0..n {
            let mut row = Vec::with_capacity(batch.num_columns());
            for col_idx in 0..batch.num_columns() {
                let col = batch.column(col_idx);
                row.push(array_value_to_json(col.as_ref(), row_idx));
            }
            rows.push(row);
        }
        if rows.len() >= max_rows {
            break;
        }
    }

    Ok(ParquetResult {
        columns,
        rows,
        total_rows,
    })
}
