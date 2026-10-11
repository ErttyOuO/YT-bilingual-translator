# Bergamot translator (vendored, unmodified)

These three files are copied byte-for-byte from the npm package
`@browsermt/bergamot-translator` **0.4.9** (`package/worker/`). Do not edit them;
`bergamot-engine.js` in the extension root wraps them.

| File | SHA-256 |
|---|---|
| `translator-worker.js` | `90257af9ee0758983501bdce77ca7ec168cd7360d4689298c20a81b0251d6b62` |
| `bergamot-translator-worker.js` | `748b2418418a2ffc6e70721aeb10098d8e6fb589ea156b91f4ae8bc3490d8f7a` |
| `bergamot-translator-worker.wasm` | `95a2b58dd6773bf1b3f345d71f9149928b9f75f4ec9c9064c0b3e42c298671b2` |

- Package tarball: <https://registry.npmjs.org/@browsermt/bergamot-translator/-/bergamot-translator-0.4.9.tgz>
  (npm integrity `sha512-bNuuCwM/JnsIYQCKXcYKFT4Qc5vLMoB8Nbvz8ReIgs7xzebK8Sa+R8iEK8mLvNBe/WaZ6zrPaUQilLsRT/ea8Q==`)
- Source code (commit recorded by npm as `gitHead`):
  <https://github.com/browsermt/bergamot-translator/tree/8cc5d0495479c9ec56eafafd6bcd7fb5b929ca98>
  — the WASM build is described in that repository's `wasm/` directory and `build-wasm.sh`.
- License: Mozilla Public License 2.0 (`LICENSE` in this folder).

Translation models are **not** bundled. They are downloaded at the user's request
from Mozilla's Remote Settings collection `translations-models` (the models Firefox
Translations uses), verified against the published SHA-256, and stored in the
extension's IndexedDB.

To check that the files are unchanged:

```bash
npm pack @browsermt/bergamot-translator@0.4.9
```

```bash
tar xzf browsermt-bergamot-translator-0.4.9.tgz && sha256sum package/worker/*
```
