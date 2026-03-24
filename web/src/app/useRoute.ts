import { useEffect, useState } from "react";
import { routes } from "./routes";

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, "") || routes.home;
  return hash === routes.overlays ? routes.overlays : routes.home;
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = next;
  };

  return { route, navigate };
}
