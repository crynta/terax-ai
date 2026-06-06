use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub fn mutex<'a, T>(lock: &'a Mutex<T>, name: &str) -> Result<MutexGuard<'a, T>, String> {
    lock.lock()
        .map_err(|error| format!("{name} lock failed: {error}"))
}

pub fn read<'a, T>(lock: &'a RwLock<T>, name: &str) -> Result<RwLockReadGuard<'a, T>, String> {
    lock.read()
        .map_err(|error| format!("{name} read lock failed: {error}"))
}

pub fn write<'a, T>(lock: &'a RwLock<T>, name: &str) -> Result<RwLockWriteGuard<'a, T>, String> {
    lock.write()
        .map_err(|error| format!("{name} write lock failed: {error}"))
}
