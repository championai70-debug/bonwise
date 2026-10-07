#!/bin/sh
# Optimise a glTF/GLB model for the web (only needed if you replace the jar or coins with a
# modelled object; the current jar is made in code and needs no files).
#   sh tools/3d/optimize_model.sh input.glb static/jar/models/name.glb
# Needs node/npx. Keeps the first view under the 1.5 MB budget:
#   - meshopt-compressed geometry, simplified where it doesn't show,
#   - textures resized to 1024 px and turned into KTX2 (UASTC for normal maps, ETC1S for colour),
#   - unused data removed and everything packed into one .glb.
# Note: meshopt/KTX2 decoders run as WebAssembly. Before loading such a model, add
# 'wasm-unsafe-eval' to script-src in SECURITY_HEADERS (app.py) and copy the decoders
# (three/examples/jsm/libs/meshopt_decoder.module.js, basis/) into static/vendor/.
set -e
IN="$1"; OUT="$2"
[ -n "$IN" ] && [ -n "$OUT" ] || { echo "usage: $0 input.glb output.glb"; exit 1; }
GT="npx --yes @gltf-transform/cli@4"
TMP=$(mktemp -d)
$GT dedup "$IN" "$TMP/a.glb"
$GT prune "$TMP/a.glb" "$TMP/b.glb"
$GT weld "$TMP/b.glb" "$TMP/c.glb"
$GT simplify "$TMP/c.glb" "$TMP/d.glb" --ratio 0.75 --error 0.001
$GT resize "$TMP/d.glb" "$TMP/e.glb" --width 1024 --height 1024
$GT uastc "$TMP/e.glb" "$TMP/f.glb" --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}" --level 2
$GT etc1s "$TMP/f.glb" "$TMP/g.glb" --slots "{baseColorTexture,emissiveTexture}" --quality 128
$GT meshopt "$TMP/g.glb" "$OUT" --level medium
rm -rf "$TMP"
ls -l "$OUT"
echo "Optional typed component: npx gltfjsx $OUT --transform (React projects only; Bonwise uses plain JS)."
