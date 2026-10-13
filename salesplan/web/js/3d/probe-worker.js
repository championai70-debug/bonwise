// Reads the graphics chip's name off the main thread: creating a WebGL context can take a while on
// some devices (and seconds on software rendering), so the page never waits for it.
let gpu = '';
let webgl2 = false;
try {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (gl) {
    webgl2 = true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
} catch { /* no WebGL in workers here */ }
postMessage({ webgl2, gpu });
