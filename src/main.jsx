import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DebugRuntimeCapture, { isDebugModeEnabled } from "./debugRuntime";
import "./index.css";

const debugModeEnabled = isDebugModeEnabled(
  typeof window !== "undefined" ? window.location.search : "",
  typeof window !== "undefined" ? window.location.hash : ""
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DebugRuntimeCapture enabled={debugModeEnabled}>
      <App />
    </DebugRuntimeCapture>
  </React.StrictMode>
);
