# Stockfish engine (third-party, GPL-3.0)

The files in this folder are an unmodified copy of the **lite, single-threaded** WebAssembly build of Stockfish, taken from the npm package `stockfish@19.0.1`.

| File | From the package |
|------|------------------|
| `stockfish-19-lite-single.js` | `bin/stockfish-19-lite-single.js` |
| `stockfish-19-lite-single.wasm` | `bin/stockfish-19-lite-single.wasm` |
| `Copying.txt` | `Copying.txt` (GNU General Public License, version 3) |

- **Upstream:** <https://github.com/nmrugg/stockfish.js> (stockfish.js by Nathan Rugg and contributors, a WebAssembly port of [Stockfish](https://stockfishchess.org/))
- **Version:** 19.0.1
- **Licence:** GPL-3.0. See `Copying.txt`.

Zhess itself is MIT-licensed. The engine is not linked into the app bundle: it is loaded as a separate Web Worker from this folder and spoken to over the UCI text protocol. The `.wasm` file must stay next to the `.js` file.

To refresh the files:

```sh
npm pack stockfish@19.0.1
tar -xzf stockfish-19.0.1.tgz
cp package/bin/stockfish-19-lite-single.js package/bin/stockfish-19-lite-single.wasm package/Copying.txt public/engine/
```
