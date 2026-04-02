import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DebugRuntimeCapture, { isDebugModeEnabled } from "./debugRuntime";
import { installSetupScannerAdapter } from "./setupScannerAdapter";
import "./index.css";


installSetupScannerAdapter(typeof window !== "undefined" ? window : undefined);

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
