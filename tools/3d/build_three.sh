#!/bin/sh
# Rebuild static/vendor/three-jar.min.js: Three.js with only the parts the 3D savings jar and the
# landing page's mascot use (static/jar, static/mascot; about 150 KB compressed instead of the full library). Needs node/npx and internet.
#   sh tools/3d/build_three.sh
# To use more of Three.js in static/jar or static/mascot, add the names to EXPORTS below and rebuild.
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
AgXToneMapping, NeutralToneMapping, SRGBColorSpace, DoubleSide, FrontSide, BackSide, DynamicDrawUsage, MathUtils, Timer, \
ExtrudeGeometry, Shape, CapsuleGeometry, SphereGeometry, ConeGeometry, TubeGeometry, CatmullRomCurve3, BoxGeometry, \
Raycaster, AdditiveBlending, CircleGeometry, IcosahedronGeometry"
cat > entry.js <<JS
export { $EXPORTS } from "./package/build/three.module.js";
export { RoomEnvironment } from "./package/examples/jsm/environments/RoomEnvironment.js";
export const REVISION = "$VERSION";
JS
npx --yes esbuild@0.25.10 entry.js --bundle --minify --format=esm --legal-comments=none \
  --alias:three=./package/build/three.module.js --banner:js="/* three.js r$VERSION (MIT, see LICENSE-three.txt): only the parts static/jar and static/mascot use. Made by tools/3d/build_three.sh. */" \
  --outfile="$REPO/static/vendor/three-jar.min.js"
cp package/LICENSE "$REPO/static/vendor/LICENSE-three.txt"
rm -rf "$TMP"
# The file is cached for a year under its URL, so the URL carries a hash of its content:
# point both loaders at the new one (old copies on phones are never reused by mistake).
HASH=$(sha256sum "$REPO/static/vendor/three-jar.min.js" | cut -c1-10)
for f in "$REPO/static/jar/loader.js" "$REPO/static/mascot/loader.js"; do
  sed -i "s|three-jar.min.js?r=[^\"]*\"|three-jar.min.js?r=$VERSION-$HASH\"|" "$f"
done
echo "loaders now use ?r=$VERSION-$HASH"
echo "static/vendor/three-jar.min.js: $(wc -c < "$REPO/static/vendor/three-jar.min.js") bytes"
