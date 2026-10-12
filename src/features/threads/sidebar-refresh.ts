import { useCallback, useRef, useState } from "react";

export function useSidebarRefresh(onRefresh: () => void, persistent = false) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const sidebarOpenRef = useRef(true);

  const refresh = useCallback(() => {
    onRefresh();
    setRefreshVersion((current) => current + 1);
  }, [onRefresh]);

  const openSidebar = useCallback(() => {
    if (sidebarOpenRef.current) return;
    sidebarOpenRef.current = true;
    setSidebarOpen(true);
    refresh();
  }, [refresh]);

  const closeSidebar = useCallback(() => {
    if (persistent || !sidebarOpenRef.current) return;
    sidebarOpenRef.current = false;
    setSidebarOpen(false);
  }, [persistent]);

  return {
    sidebarOpen: persistent || sidebarOpen,
    refreshVersion,
    openSidebar,
    closeSidebar,
    refresh,
  };
}
