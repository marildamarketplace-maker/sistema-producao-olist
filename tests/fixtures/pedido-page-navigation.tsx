import { useSyncExternalStore } from "react";
const assinar = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};
export function useSearchParams() {
  const query = useSyncExternalStore(assinar, () => location.search);
  return new URLSearchParams(query);
}
