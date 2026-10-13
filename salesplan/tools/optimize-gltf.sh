#!/usr/bin/env bash
# Shrinks a glTF/GLB model for the app with gltf-transform (MIT, a dev-time tool; nothing here ships):
#   - removes unused data, joins and welds meshes, simplifies a little
#   - textures to KTX2 (ETC1S for colour, UASTC for normal and roughness maps), at most 1024 px
#   - geometry with Meshopt compression (smaller to decode than Draco; use --draco to pick Draco)
#
#   salesplan/tools/optimize-gltf.sh input.glb web/models/name.glb [--draco]
#
# Needs Node and, for KTX2, the `toktx` binary from KTX-Software (https://github.com/KhronosGroup/KTX-Software).
# Loading a model in the app also needs GLTFLoader, KTX2Loader with the Basis transcoder and the
# Meshopt or Draco decoder copied into web/vendor/three/addons — see "Adding or replacing 3D assets"
# in salesplan/README.md. Today's scenes are made in code and load no model files.
set -euo pipefail
in=${1:?input .glb or .gltf}
out=${2:?output .glb}
geo=meshopt
[ "${3:-}" = "--draco" ] && geo=draco
cli="npx --yes @gltf-transform/cli@4"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

$cli prune "$in" "$tmp/1.glb"
$cli dedup "$tmp/1.glb" "$tmp/2.glb"
$cli join "$tmp/2.glb" "$tmp/3.glb"
$cli weld "$tmp/3.glb" "$tmp/4.glb"
$cli simplify "$tmp/4.glb" "$tmp/5.glb" --ratio 0.75 --error 0.001
$cli resize "$tmp/5.glb" "$tmp/6.glb" --width 1024 --height 1024
if command -v toktx >/dev/null; then
  $cli etc1s "$tmp/6.glb" "$tmp/7.glb" --slots "{baseColorTexture,emissiveTexture}"
  $cli uastc "$tmp/7.glb" "$tmp/8.glb" --slots "{normalTexture,occlusionTexture,metallicRoughnessTexture}"
else
  echo "toktx not found: textures stay as they are (install KTX-Software for KTX2)" >&2
  cp "$tmp/6.glb" "$tmp/8.glb"
fi
if [ "$geo" = draco ]; then $cli draco "$tmp/8.glb" "$out"; else $cli meshopt "$tmp/8.glb" "$out"; fi
ls -l "$in" "$out"
