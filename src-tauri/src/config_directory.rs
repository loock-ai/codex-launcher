use std::path::{Path,PathBuf};
pub fn resolve(home:&Path,data:&Path,explicit:Option<PathBuf>)->std::io::Result<PathBuf>{
    if let Some(path)=explicit{return Ok(path)}
    let destination=home.join(".codex-launcher");
    let legacy=data.join("codex-mobile");
    if !destination.try_exists()? && legacy.try_exists()? {
        std::fs::create_dir_all(home)?;
        std::fs::rename(&legacy,&destination)?;
    }
    Ok(destination)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("launcher-config-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::SeqCst)));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn migrates_plugin_files_and_settings_without_resetting() {
        let root=fixture();let home=root.join("home");let data=root.join("data");
        let old=data.join("codex-mobile");std::fs::create_dir_all(old.join("plugins/custom")).unwrap();
        std::fs::write(old.join("config.json"),"saved-token").unwrap();
        std::fs::write(old.join("plugins/custom/inject.js"),"user-script").unwrap();
        let dest=resolve(&home,&data,None).unwrap();
        assert_eq!(dest,home.join(".codex-launcher"));
        assert_eq!(std::fs::read_to_string(dest.join("config.json")).unwrap(),"saved-token");
        assert_eq!(std::fs::read_to_string(dest.join("plugins/custom/inject.js")).unwrap(),"user-script");
        assert!(!old.exists());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn existing_destination_and_explicit_path_are_never_overwritten() {
        let root=fixture();let data=root.join("data");let old=data.join("codex-mobile");
        std::fs::create_dir_all(&old).unwrap();std::fs::write(old.join("config.json"),"old").unwrap();
        let dest=root.join(".codex-launcher");std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("config.json"),"new").unwrap();
        assert_eq!(resolve(&root,&data,None).unwrap(),dest);
        assert_eq!(std::fs::read_to_string(dest.join("config.json")).unwrap(),"new");
        let custom=root.join("custom");assert_eq!(resolve(&root,&data,Some(custom.clone())).unwrap(),custom);
        assert!(old.exists());std::fs::remove_dir_all(root).unwrap();
    }
}
