import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";

// Solana web3/wallet-adapter expect Node's Buffer in the browser.
globalThis.Buffer = globalThis.Buffer ?? Buffer;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
