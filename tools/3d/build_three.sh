#!/bin/sh
# Rebuild static/vendor/three-jar.min.js: Three.js with only the parts the 3D savings jar
# uses (about 130 KB compressed instead of the full library). Needs node/npx and internet.
#   sh tools/3d/build_three.sh
# To use more of Three.js in static/jar/*.js, add the names to EXPORTS below and rebuild.
set -e
VERSION=0.186.1
REPO=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
cd "$TMP"
npm pack "three@$VERSION" --silent >/dev/null
tar xzf "three-$VERSION.tgz"
EXPORTS="WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, LatheGeometry, CylinderGeometry, \
PlaneGeometry, TorusGeometry, MeshPhysicalMaterial, MeshStandardMaterial, MeshBasicMaterial, DirectionalLight, \
HemisphereLight, Vector2, Vector3, Quaternion, Euler, Matrix4, Object3D, Color, CanvasTexture, PMREMGenerator, \
AgXToneMapping, SRGBColorSpace, DoubleSide, FrontSide, BackSide, DynamicDrawUsage, MathUtils, Timer"
cat > entry.js <<JS
export { $EXPORTS } from "./package/build/three.module.js";
export { RoomEnvironment } from "./package/examples/jsm/environments/RoomEnvironment.js";
export const REVISION = "$VERSION";
JS
npx --yes esbuild@0.25.10 entry.js --bundle --minify --format=esm --legal-comments=none \
  --alias:three=./package/build/three.module.js --banner:js="/* three.js r$VERSION (MIT, see LICENSE-three.txt): only the parts static/jar uses. Made by tools/3d/build_three.sh. */" \
  --outfile="$REPO/static/vendor/three-jar.min.js"
cp package/LICENSE "$REPO/static/vendor/LICENSE-three.txt"
rm -rf "$TMP"
echo "static/vendor/three-jar.min.js: $(wc -c < "$REPO/static/vendor/three-jar.min.js") bytes"
