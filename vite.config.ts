import { defineConfig } from "vite";

const formatLocalTimestamp = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
    const offsetMins = pad(Math.abs(offsetMinutes) % 60);
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC${offsetSign}${offsetHours}:${offsetMins}`;
};

const fiberWasmBuildTime =
    process.env.FIBER_WASM_BUILD_TIME ?? formatLocalTimestamp(new Date());

export default defineConfig({
    base: "./",
    define: {
        "import.meta.env.VITE_FIBER_WASM_BUILD_TIME": JSON.stringify(fiberWasmBuildTime),
        global: "globalThis",
    },
    resolve: {
        alias: {
            buffer: "buffer/",
        },
    },
    optimizeDeps: {
        include: ["buffer"],
    },
    server: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cache-Control": "no-store",
            Pragma: "no-cache",
            Expires: "0",
        },
    },
    preview: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cache-Control": "no-store",
            Pragma: "no-cache",
            Expires: "0",
        },
    },
});
