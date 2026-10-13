#!/usr/bin/env bash
# Rebuilds web/vendor/three and web/vendor/gsap from npm, the way they are bundled today:
# minified ES modules, bare imports ('three', 'three/webgpu', 'three/tsl') rewritten to relative paths,
# so they load with no bundler, under the strict CSP and with no network (Android app).
#
#   salesplan/tools/vendor-3d.sh [three-version] [gsap-version]
#
# Afterwards: update the byte sizes in web/js/3d/loader.js (the test prints the right ones), bump the
# cache name in web/sw.js, run the tests and look at the 3D in a browser.
set -euo pipefail
three=${1:-0.186.1}
gsap=${2:-3.15.0}
web=$(cd "$(dirname "$0")/../web" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
npm pack "three@$three" "gsap@$gsap" --silent >/dev/null
mkdir three gsap
tar xzf three-*.tgz -C three && tar xzf gsap-*.tgz -C gsap
npm init -y >/dev/null && npm install --silent esbuild@0.25.10 >/dev/null
es="npx esbuild --minify --format=esm --log-level=error --legal-comments=inline"
T=three/package
out="$web/vendor/three"
rm -rf "$out" && mkdir -p "$out/addons"
$es $T/build/three.core.js > "$out/three.core.min.js"
$es $T/build/three.webgpu.js > "$out/three.webgpu.min.js"
$es $T/build/three.tsl.js > "$out/three.tsl.min.js"
for f in controls/OrbitControls geometries/RoundedBoxGeometry tsl/display/BloomNode tsl/display/GTAONode \
         tsl/display/ChromaticAberrationNode tsl/display/GaussianBlurNode; do
  $es "$T/examples/jsm/$f.js" > "$out/addons/$(basename "$f").js"
done
cp $T/LICENSE "$out/LICENSE"
sed -i 's#from"./three.core.js"#from"./three.core.min.js"#g' "$out/three.webgpu.min.js"
sed -i 's#from"three/webgpu"#from"./three.webgpu.min.js"#g' "$out/three.tsl.min.js"
sed -i 's#from"three/webgpu"#from"../three.webgpu.min.js"#g; s#from"three/tsl"#from"../three.tsl.min.js"#g; s#from"three"#from"../three.webgpu.min.js"#g' "$out"/addons/*.js
mkdir -p "$web/vendor/gsap"
npx esbuild gsap/package/gsap-core.js --bundle --minify --format=esm --log-level=error --legal-comments=inline > "$web/vendor/gsap/gsap-core.min.js"
ls -l "$out" "$out/addons" "$web/vendor/gsap"
