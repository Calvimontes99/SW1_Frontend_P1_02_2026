/**
 * Web Worker de la IA local: Whisper (voz a texto) y el modelo de lenguaje corren
 * aquí para que el editor no se congele mientras procesan.
 */
import { pipeline, env } from '@huggingface/transformers';
import { cacheOPFS, opfsDisponible } from './cacheModelos.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Los pesos del modelo de lenguaje (~2 GB) no caben en Cache Storage: se guardan en OPFS
if (opfsDisponible()) {
  env.useCustomCache = true;
  env.customCache = cacheOPFS;
}
// ONNX Runtime se sirve desde la propia app (public/ort). Por defecto
// transformers.js lo descarga de una CDN y sin internet no cargaría.
env.backends.onnx.wasm.wasmPaths = {
  mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
};

const TAREA = { voz: 'automatic-speech-recognition', texto: 'text-generation' };
const cargados = {};

const claveDe = (c) => `${c.id}|${c.device}|${JSON.stringify(c.dtype)}|${JSON.stringify(c.sesion || {})}`;
const esErrorDeRed = (e) => /failed to fetch|networkerror|network error|load failed|err_internet|err_name_not_resolved/i.test(String(e?.message || e));

const cargar = (tipo, config, informar) => {
  const clave = claveDe(config);
  if (cargados[tipo]?.clave === clave) return cargados[tipo].promesa;
  // Otro modelo para la misma tarea: se libera el anterior (la memoria WASM del
  // worker no alcanza para dos modelos grandes a la vez)
  if (cargados[tipo]) {
    cargados[tipo].promesa.then((anterior) => anterior?.dispose?.()).catch(() => {});
    delete cargados[tipo];
  }
  const crear = () => pipeline(TAREA[tipo], config.id, {
    device: config.device,
    dtype: config.dtype,
    // Opciones de ONNX Runtime por modelo (p. ej. el nivel de optimización del grafo)
    ...(config.sesion ? { session_options: config.sesion } : {}),
    progress_callback: informar,
  });
  const promesa = (async () => {
    try {
      env.allowRemoteModels = true;
      return await crear();
    } catch (error) {
      if (!esErrorDeRed(error)) throw error;
      // Sin internet: usar solo lo que ya quedó en la caché del navegador
      env.allowRemoteModels = false;
      return await crear();
    }
  })();
  cargados[tipo] = { clave, promesa };
  promesa.catch(() => {
    if (cargados[tipo]?.promesa === promesa) delete cargados[tipo];
  });
  return promesa;
};

self.onmessage = async ({ data }) => {
  const { id, accion } = data;
  const informar = (progreso) => self.postMessage({ id, tipo: 'progreso', progreso });
  try {
    if (accion === 'cargar') {
      await cargar(data.tipoModelo, data.config, informar);
      self.postMessage({ id, tipo: 'resultado', resultado: true });
    } else if (accion === 'transcribir') {
      const asr = await cargar('voz', data.config, informar);
      const salida = await asr(data.audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ id, tipo: 'resultado', resultado: String(salida?.text || '').trim() });
    } else if (accion === 'generar') {
      const generador = await cargar('texto', data.config, informar);
      // repetition_penalty evita que un modelo pequeño se quede repitiendo la misma frase
      const salida = await generador(data.mensajes, { max_new_tokens: data.maxTokens || 350, do_sample: false, repetition_penalty: 1.1 });
      const generado = salida?.[0]?.generated_text;
      const respuesta = Array.isArray(generado) ? generado.at(-1)?.content : generado;
      self.postMessage({ id, tipo: 'resultado', resultado: String(respuesta || '') });
    } else {
      throw new Error(`Acción desconocida: ${accion}`);
    }
  } catch (error) {
    self.postMessage({ id, tipo: 'error', error: error?.message || String(error) });
  }
};
