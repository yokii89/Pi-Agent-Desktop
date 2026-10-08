import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/global.css";

// M1 默认暗色（docs/design/02 §4）；主题切换由 uiStore 写 data-theme
document.documentElement.dataset.theme = "dark";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<App />);
}
