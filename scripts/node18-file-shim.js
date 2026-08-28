// @vscode/vsce arrastra undici, que en Node 20+ usa el global `File` (Web API).
// En Node 18 no existe como global (sí en node:buffer desde 18.13) -> vsce
// revienta con "ReferenceError: File is not defined" al empaquetar.
// Ver README.md § Node 18 para el porqué.
global.File = require("node:buffer").File;
