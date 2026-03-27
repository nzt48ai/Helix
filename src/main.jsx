import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DebugRuntimeCapture, { isDebugModeEnabled } from "./debugRuntime";
import "./index.css";

const debugModeEnabled = isDebugModeEnabled();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DebugRuntimeCapture enabled={debugModeEnabled}>
      <App />
    </DebugRuntimeCapture>
  </React.StrictMode>
);
