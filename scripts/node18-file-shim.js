// @vscode/vsce pulls in undici, which on Node 20+ uses the global `File` (Web API).
// On Node 18 it doesn't exist as a global (it does in node:buffer since 18.13) -> vsce
// blows up with "ReferenceError: File is not defined" when packaging.
// See README.md § Node 18 for why.
global.File = require("node:buffer").File;
