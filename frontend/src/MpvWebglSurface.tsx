import { useEffect, useRef } from "react";
import type { MpvFrame } from "./backend";
import { cn } from "./utils/cn";

const MAX_RENDER_WIDTH = 3840;
const MAX_RENDER_HEIGHT = 2160;
const MAX_RENDER_PIXELS = MAX_RENDER_WIDTH * MAX_RENDER_HEIGHT;
const MAX_TEXTURE_RENDER_FPS = 60;

type MpvWebglSurfaceProps = {
  active: boolean;
  paused: boolean;
  videoWidth?: number;
  videoHeight?: number;
  fps?: number;
  generation?: number;
  className?: string;
  onError?: (message: string) => void;
  onFrame?: (frame: MpvFrame) => void;
};

type GlState = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  texture: WebGLTexture;
  scaleLocation: WebGLUniformLocation;
  sourceWidth: number;
  sourceHeight: number;
};

export function MpvWebglSurface({
  active,
  paused,
  videoWidth,
  videoHeight,
  fps,
  generation = 0,
  className,
  onError,
  onFrame,
}: MpvWebglSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glStateRef = useRef<GlState | null>(null);
  const activeRef = useRef(active);
  const pausedRef = useRef(paused);
  const generationRef = useRef(generation);
  const dimensionsRef = useRef({ width: videoWidth, height: videoHeight, fps });
  const onErrorRef = useRef(onError);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    generationRef.current = generation;
  }, [generation]);

  useEffect(() => {
    dimensionsRef.current = { width: videoWidth, height: videoHeight, fps };
  }, [videoWidth, videoHeight, fps]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const mpvRenderFrame = window.nexplay?.mpvRenderFrame;
    if (!canvas || !mpvRenderFrame) {
      return;
    }

    const glState = ensureGlState(canvas);
    if (!glState) {
      onErrorRef.current?.("当前环境无法创建 WebGL 播放画布");
      return;
    }
    glStateRef.current = glState;

    let disposed = false;
    let rafId = 0;
    let inFlight = false;
    let lastSubmitAt = 0;
    let hasFrame = false;
    let pausedFrameCaptured = false;
    let lastError = "";
    let adaptiveFrameInterval = 0;
    let observedGeneration = generationRef.current;

    const renderLoop = (now: number) => {
      if (disposed) {
        return;
      }
      if (observedGeneration !== generationRef.current) {
        observedGeneration = generationRef.current;
        hasFrame = false;
        pausedFrameCaptured = false;
        lastSubmitAt = 0;
      }

      const { fps: currentFps } = dimensionsRef.current;
      const targetFps = Math.max(1, Math.min(MAX_TEXTURE_RENDER_FPS, currentFps || 30));
      const frameInterval = 1000 / targetFps;
      const isPaused = pausedRef.current;
      const fetchInterval = Math.max(frameInterval, adaptiveFrameInterval);
      const shouldFetch = activeRef.current && !inFlight && (
        !hasFrame || (!isPaused && now - lastSubmitAt >= fetchInterval) || (isPaused && !pausedFrameCaptured)
      );

      const resized = resizeCanvasToDisplaySize(canvas);
      if (shouldFetch) {
        inFlight = true;
        lastSubmitAt = now;
        const { width, height } = chooseRenderSize(canvas, dimensionsRef.current.width, dimensionsRef.current.height);
        const requestStartedAt = performance.now();
        const requestGeneration = generationRef.current;
        mpvRenderFrame(width, height)
          .then((frame) => {
            if (disposed || frame.ok === false || requestGeneration !== generationRef.current || !activeRef.current) {
              return;
            }
            uploadFrame(glState, frame);
            onFrameRef.current?.(frame);
            hasFrame = true;
            pausedFrameCaptured = pausedRef.current;
            lastError = "";
          })
          .catch((caught) => {
            const message = caught instanceof Error ? caught.message : String(caught);
            if (message !== lastError) {
              lastError = message;
              onErrorRef.current?.(message);
            }
          })
          .finally(() => {
            const requestMs = performance.now() - requestStartedAt;
            const nextAdaptiveInterval = Math.min(250, Math.max(0, requestMs * 1.15));
            adaptiveFrameInterval = adaptiveFrameInterval <= 0
              ? nextAdaptiveInterval
              : adaptiveFrameInterval * 0.82 + nextAdaptiveInterval * 0.18;
            if (!pausedRef.current) {
              pausedFrameCaptured = false;
            }
            inFlight = false;
          });
      } else if (resized && hasFrame) {
        drawFrame(glState);
      }

      rafId = window.requestAnimationFrame(renderLoop);
    };

    rafId = window.requestAnimationFrame(renderLoop);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      glStateRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn("mpv-webgl-surface absolute inset-0 size-full", className)}
      aria-hidden
    />
  );
}

function ensureGlState(canvas: HTMLCanvasElement): GlState | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (!gl) {
    return null;
  }

  const program = createProgram(gl);
  const texture = gl.createTexture();
  const scaleLocation = gl.getUniformLocation(program, "u_scale");
  if (!program || !texture || !scaleLocation) {
    return null;
  }

  gl.useProgram(program);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.clearColor(0, 0, 0, 1);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 1,
    1, 1,
    0, 0,
    0, 0,
    1, 1,
    1, 0,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(texCoordLocation);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

  const samplerLocation = gl.getUniformLocation(program, "u_texture");
  gl.uniform1i(samplerLocation, 0);

  return {
    gl,
    program,
    texture,
    scaleLocation,
    sourceWidth: 0,
    sourceHeight: 0,
  };
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform vec2 u_scale;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texCoord;

    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `);
  const program = gl.createProgram();
  if (!vertexShader || !fragmentShader || !program) {
    throw new Error("failed to create WebGL shader program");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "failed to link WebGL shader program");
  }
  return program;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "failed to compile WebGL shader");
  }
  return shader;
}

function chooseRenderSize(canvas: HTMLCanvasElement, videoWidth?: number, videoHeight?: number) {
  const canvasWidth = Math.max(2, canvas.width || Math.round(canvas.clientWidth || 2));
  const canvasHeight = Math.max(2, canvas.height || Math.round(canvas.clientHeight || 2));
  const sourceWidth = Math.max(2, Math.round(videoWidth || canvasWidth));
  const sourceHeight = Math.max(2, Math.round(videoHeight || canvasHeight));
  const scale = Math.min(
    canvasWidth / sourceWidth,
    canvasHeight / sourceHeight,
    MAX_RENDER_WIDTH / sourceWidth,
    MAX_RENDER_HEIGHT / sourceHeight,
    Math.sqrt(MAX_RENDER_PIXELS / (sourceWidth * sourceHeight)),
    1,
  );
  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale)),
  };
}

function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round((canvas.clientWidth || 2) * pixelRatio));
  const height = Math.max(2, Math.round((canvas.clientHeight || 2) * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function uploadFrame(state: GlState, frame: MpvFrame) {
  const { gl } = state;
  const pixels = frame.pixels instanceof Uint8Array ? frame.pixels : new Uint8Array(frame.pixels);
  gl.useProgram(state.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texture);
  if (state.sourceWidth !== frame.width || state.sourceHeight !== frame.height) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    state.sourceWidth = frame.width;
    state.sourceHeight = frame.height;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.width, frame.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  drawFrame(state);
}

function drawFrame(state: GlState) {
  const { gl } = state;
  if (!state.sourceWidth || !state.sourceHeight) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const canvasAspect = gl.canvas.width / gl.canvas.height;
  const frameAspect = state.sourceWidth / state.sourceHeight;
  const scaleX = frameAspect > canvasAspect ? 1 : frameAspect / canvasAspect;
  const scaleY = frameAspect > canvasAspect ? canvasAspect / frameAspect : 1;
  gl.uniform2f(state.scaleLocation, scaleX, scaleY);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
