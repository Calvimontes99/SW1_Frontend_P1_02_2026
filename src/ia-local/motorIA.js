/**
 * Puente con el Web Worker de la IA local: descarga/carga de modelos con progreso,
 * transcripción de audio y generación de texto.
 */

import { archivoEnOPFS, opfsDisponible, urlDeModelo } from './cacheModelos.js';

let trabajador = null;
let secuencia = 0;
const pendientes = new Map();

const obtenerTrabajador = () => {
  if (trabajador) return trabajador;
  trabajador = new Worker(new URL('./trabajadorIA.js', import.meta.url), { type: 'module' });
  trabajador.onmessage = ({ data }) => {
    const pendiente = pendientes.get(data.id);
    if (!pendiente) return;
    if (data.tipo === 'progreso') {
      pendiente.alProgresar?.(data.progreso);
      return;
    }
    pendientes.delete(data.id);
    if (data.tipo === 'error') pendiente.reject(new Error(data.error));
    else pendiente.resolve(data.resultado);
  };
  trabajador.onerror = (evento) => {
    const error = new Error(evento.message || 'La IA local se detuvo');
    pendientes.forEach((p) => p.reject(error));
    pendientes.clear();
    trabajador = null;
  };
  return trabajador;
};

const pedir = (mensaje, alProgresar, transferibles = []) => new Promise((resolve, reject) => {
  const id = ++secuencia;
  pendientes.set(id, { resolve, reject, alProgresar });
  obtenerTrabajador().postMessage({ id, ...mensaje }, transferibles);
});

const claveModelo = (c) => `ia.modelo.listo.${c.id}|${c.device}|${JSON.stringify(c.dtype)}`;

/**
 * ¿Están en la caché del navegador TODOS los archivos que usó este modelo al prepararse?
 * Sin esa comprobación un modelo podía figurar como listo aunque el navegador no hubiera
 * podido guardar su archivo de pesos (p. ej. por falta de espacio) y sin internet fallaba.
 */
export const modeloDescargado = async (config) => {
  if (!config) return false;
  let archivos;
  try {
    archivos = JSON.parse(localStorage.getItem(claveModelo(config)) || 'null');
  } catch {
    return false;
  }
  if (!Array.isArray(archivos) || !archivos.length) return false;
  if (opfsDisponible()) {
    const presentes = await Promise.all(archivos.map((a) => archivoEnOPFS(urlDeModelo(config.id, a))));
    return presentes.every(Boolean);
  }
  try {
    if (typeof caches === 'undefined') return true;
    const cache = await caches.open('transformers-cache');
    const urls = (await cache.keys()).map((r) => r.url).filter((u) => u.includes(`/${config.id}/`));
    return archivos.every((archivo) => urls.some((u) => u.endsWith(`/${archivo}`)));
  } catch {
    return true;
  }
};

/**
 * Descarga (la primera vez) y carga un modelo.
 * alProgresar recibe { estado, archivo, cargado, total, progreso (0..1) }.
 */
export const prepararModelo = async (tipoModelo, config, alProgresar) => {
  const archivos = new Map();
  const informar = (p) => {
    if (p.file && !archivos.has(p.file)) archivos.set(p.file, { cargado: 0, total: 0 });
    if (p.file && (p.status === 'progress' || p.status === 'download' || p.status === 'initiate')) {
      const actual = archivos.get(p.file) || { cargado: 0, total: 0 };
      archivos.set(p.file, { cargado: p.loaded ?? actual.cargado, total: p.total ?? actual.total });
    }
    if (p.file && p.status === 'done' && archivos.has(p.file)) {
      const a = archivos.get(p.file);
      archivos.set(p.file, { ...a, cargado: a.total || a.cargado });
    }
    const cargado = [...archivos.values()].reduce((s, a) => s + (a.cargado || 0), 0);
    const total = [...archivos.values()].reduce((s, a) => s + (a.total || 0), 0);
    alProgresar?.({ estado: p.status, archivo: p.file, cargado, total, progreso: total ? cargado / total : 0 });
  };
  await pedir({ accion: 'cargar', tipoModelo, config }, informar);
  // Se anotan los archivos que usó el modelo para comprobar después que siguen en la caché
  try {
    localStorage.setItem(claveModelo(config), JSON.stringify([...archivos.keys()]));
  } catch { /* sin almacenamiento */ }
  if (!(await modeloDescargado(config))) {
    throw new Error('El modelo funciona, pero el navegador no pudo guardarlo completo para usarlo sin internet (falta espacio o el archivo es demasiado grande para este navegador).');
  }
};

/** Audio grabado (webm/ogg/wav) -> Float32Array mono a 16 kHz, lo que espera Whisper. */
export const decodificarAudio = async (blob) => {
  const datos = await blob.arrayBuffer();
  const Contexto = window.AudioContext || window.webkitAudioContext;
  const contexto = new Contexto({ sampleRate: 16000 });
  try {
    const audio = await contexto.decodeAudioData(datos);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
    const mezcla = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const canal = audio.getChannelData(c);
      for (let i = 0; i < audio.length; i++) mezcla[i] += canal[i] / audio.numberOfChannels;
    }
    return mezcla;
  } finally {
    contexto.close();
  }
};

export const transcribirAudio = async (blob, config, alProgresar) => {
  const audio = await decodificarAudio(blob);
  return pedir({ accion: 'transcribir', config, audio }, alProgresar, [audio.buffer]);
};

export const generarTexto = (mensajes, config, alProgresar) => pedir({ accion: 'generar', config, mensajes }, alProgresar);
