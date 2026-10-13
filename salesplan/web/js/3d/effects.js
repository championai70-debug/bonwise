// Effects: the post-processing chain, three's RenderPipeline with TSL nodes (works on WebGPU and on
// the WebGL2 fallback). Kept subtle, in this order:
//   1. ambient occlusion (GTAO, half size; high tier only)
//   2. bloom: only light brighter than white (the light cores) glows
//   3. exposure
//   4. tone mapping (ACES by default, see quality.js) and sRGB output
//   5. grading: a little saturation and contrast, cool shadows, warm highlights
//   6. lens: a very light colour fringe at the edges (high tier) and a vignette
// The low tier skips the chain; the renderer then tone maps by itself.

import { THREE } from './scene.js';
import {
  pass, mrt, normalView, renderOutput, uniform, vec2, vec3, vec4, float, screenUV, smoothstep, length, mix,
  saturation, luminance, builtinAOContext,
} from '../../vendor/three/three.tsl.min.js';
import { bloom } from '../../vendor/three/addons/BloomNode.js';
import { ao } from '../../vendor/three/addons/GTAONode.js';
import { chromaticAberration } from '../../vendor/three/addons/ChromaticAberrationNode.js';

const TONE = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };

export function effects(stage) {
  const { renderer, scene, camera, q } = stage;
  if (!q.post) return null;
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // tone mapping happens inside the chain, before grading
  const exposure = uniform(stage.exposure);
  let nodes = [];

  const build = () => {
    nodes.forEach((n) => n.dispose?.());
    nodes = [];
    const scenePass = pass(scene, camera, { samples: q.msaa });
    nodes.push(scenePass);
    if (q.ao) {
      const pre = pass(scene, camera);
      pre.setMRT(mrt({ output: normalView }));
      const aoPass = ao(pre.getTextureNode('depth'), pre.getTextureNode(), camera);
      aoPass.resolutionScale = 0.5;
      aoPass.samples.value = 8;
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      nodes.push(pre, aoPass);
    }
    let c = scenePass;
    if (q.bloom) {
      const b = bloom(scenePass, q.bloom.strength, q.bloom.radius, q.bloom.threshold);
      if (q.bloom.scale < 1) b.setResolutionScale(q.bloom.scale);
      nodes.push(b);
      c = c.add(b);
    }
    c = vec4(c.rgb.mul(exposure), 1);
    c = renderOutput(c, TONE[q.toneMapping] ?? THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    if (q.grading) {
      let rgb = saturation(c.rgb, 1.1);
      const l = luminance(rgb);
      rgb = mix(rgb.mul(vec3(0.95, 0.97, 1.07)), rgb.mul(vec3(1.03, 1.0, 0.97)), smoothstep(0.25, 0.8, l));
      rgb = rgb.sub(0.5).mul(1.05).add(0.5).clamp(0, 1);
      c = vec4(rgb, 1);
    }
    if (q.lens) {
      if (q.lens.aberration) c = chromaticAberration(c, q.lens.aberration, vec2(0.5, 0.5));
      const d = length(screenUV.sub(0.5).mul(vec2(1, 0.8)));
      c = vec4(c.rgb.mul(float(1).sub(smoothstep(0.35, 0.85, d).mul(q.lens.vignette))), 1);
    }
    pipeline.outputNode = c;
    pipeline.needsUpdate = true;
  };
  build();

  // When frames stay slow at the lowest pixel ratio: drop AO first, then the colour fringe, then make bloom smaller.
  stage.onSlow = () => {
    if (q.ao) q.ao = false;
    else if (q.lens?.aberration) q.lens.aberration = 0;
    else if (q.bloom && q.bloom.scale > 0.5) q.bloom.scale = 0.5;
    else return;
    build();
  };

  return {
    exposure,
    render: () => pipeline.render(),
    dispose: () => { nodes.forEach((n) => n.dispose?.()); pipeline.dispose(); },
  };
}
