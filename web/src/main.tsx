import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import { App } from "./app/App";
import "./styles.css";

createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
