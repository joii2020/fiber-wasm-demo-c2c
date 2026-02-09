/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_FIBER_WASM_BUILD_TIME: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
