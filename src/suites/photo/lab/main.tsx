import { createRoot } from "react-dom/client";
import "@/index.css";
import { PhotoLab } from "./lab.tsx";

createRoot(document.getElementById("root")!).render(<PhotoLab />);
