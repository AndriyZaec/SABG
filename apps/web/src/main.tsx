import React from "react";
import ReactDOM from "react-dom/client";
import { siteForHostname } from "./site.js";
import "./styles/theme.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function render(element: React.ReactNode) {
  root.render(<React.StrictMode>{element}</React.StrictMode>);
}

async function start() {
  if (siteForHostname(window.location.hostname) === "landing") {
    const { LandingPage } = await import("./landing/LandingPage.js");
    document.title = "SABG — Can you survive the match?";
    render(<LandingPage />);
    return;
  }

  document.title = "SABG — Live esports prediction game";

  const [{ Buffer }, { App }] = await Promise.all([import("buffer"), import("./App.js")]);

  // Solana web3/wallet-adapter expect Node's Buffer in the browser.
  globalThis.Buffer = globalThis.Buffer ?? Buffer;

  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "/manifest.webmanifest";
  document.head.append(manifest);

  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js");
  }

  render(<App />);
}

void start();
