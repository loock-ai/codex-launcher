#[derive(Debug, PartialEq, Eq)]
pub enum LaunchAction {
    StartPlugins,
    OpenWeb,
}

pub fn launch_actions(args: &[String]) -> Vec<LaunchAction> {
    let auto_start = !args.iter().any(|arg| arg == "--no-auto-start");
    let open_web = args.iter().any(|arg| arg == "--open-web");
    let mut actions = Vec::new();
    if auto_start {
        actions.push(LaunchAction::StartPlugins);
    }
    if open_web {
        actions.push(LaunchAction::OpenWeb);
    }
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    fn actions(args: &[&str]) -> Vec<LaunchAction> {
        launch_actions(&args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>())
    }
    #[test]
    fn ordinary_launch_starts_plugins_for_first_and_second_instance() {
        assert_eq!(actions(&["launcher"]), vec![LaunchAction::StartPlugins]);
    }
    #[test]
    fn open_web_starts_plugins_before_opening_mobile() {
        assert_eq!(
            actions(&["launcher", "--open-web"]),
            vec![LaunchAction::StartPlugins, LaunchAction::OpenWeb]
        );
    }
    #[test]
    fn no_auto_start_shows_only() {
        assert!(actions(&["launcher", "--no-auto-start"]).is_empty());
    }
    #[test]
    fn explicit_web_can_open_without_starting_other_plugins() {
        assert_eq!(
            actions(&["launcher", "--open-web", "--no-auto-start"]),
            vec![LaunchAction::OpenWeb]
        );
        assert_eq!(
            actions(&["launcher", "--no-auto-start", "--open-web"]),
            vec![LaunchAction::OpenWeb]
        );
    }
    #[test]
    fn unrelated_flags_do_not_disable_auto_start() {
        assert_eq!(
            actions(&["launcher", "--config-dir", "/tmp/config", "--no-desktop"]),
            vec![LaunchAction::StartPlugins]
        );
    }
}
