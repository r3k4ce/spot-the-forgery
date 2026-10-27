import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="p-6 font-serif">Spot the Forgery</main>
  </StrictMode>,
);
