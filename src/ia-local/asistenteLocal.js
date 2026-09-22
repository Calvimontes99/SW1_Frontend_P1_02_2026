/**
 * Decide qué IA usar y resuelve los pedidos con la IA local.
 *
 * Con conexión al servidor se usa la IA en la nube (Gemini). Sin conexión, o si el
 * usuario lo elige, todo se resuelve en el navegador:
 *   1. el intérprete de órdenes, si entiende el pedido completo (instantáneo);
 *   2. si no, el modelo de lenguaje local traduce el pedido a órdenes;
 *   3. si no hay modelo descargado, se aplica lo que el intérprete sí entendió.
 */
import { interpretar, aplicarOperaciones } from './interpreteOrdenes.js';
import { construirMensajes, construirMensajesImagen, limpiarRespuesta } from './promptOrdenes.js';
import { modeloTextoActual, modeloVozActual, nivelActual, preferenciasIA } from './configuracionIA.js';
import { estadoOllama, generarConOllama, modeloOllamaPorDefecto, modeloVistaPorDefecto } from './ollama.js';
import { generarTexto, modeloDescargado, transcribirAudio } from './motorIA.js';

// En desarrollo vienen de .env.development; en producción el backend sirve la app (mismo origen)
const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_WS_URL || window.location.origin;
let comprobacion = { cuando: 0, disponible: false };

/** ¿Se puede usar la IA del servidor? No si no hay red o si el usuario eligió "siempre local". */
export const iaNubeDisponible = async () => {
  if (preferenciasIA().siempreLocal) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (Date.now() - comprobacion.cuando < 15000) return comprobacion.disponible;
  let disponible = false;
  try {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), 2500);
    const respuesta = await fetch(`${API_BASE}/apis/ai/health`, { signal: control.signal, credentials: 'include' });
    clearTimeout(temporizador);
    disponible = respuesta.ok;
  } catch {
    disponible = false;
  }
  comprobacion = { cuando: Date.now(), disponible };
  return disponible;
};

export const olvidarEstadoNube = () => { comprobacion = { cuando: 0, disponible: false }; };

/**
 * El modelo a veces describe la misma asociación dos veces, en sentido inverso
 * ("Habitacion 1 a muchos Reserva" y "Reserva 1 a 1 Habitacion"): se deja la primera.
 */
const sinAsociacionesRepetidas = (operaciones) => {
  const pares = new Set();
  return operaciones.filter((op) => {
    if (op.op !== 'relacion' || op.tipo !== 'Association') return true;
    const par = [op.origen.nombre, op.destino.nombre].map((n) => n.toLowerCase()).sort().join('|');
    if (pares.has(par)) return false;
    pares.add(par);
    return true;
  });
};

/**
 * @returns {{ nodes, edges, cambios, resumen, avisos, motor, noEntendidas, ordenes?, errorModelo?, modeloDisponible }}
 */
export const resolverConIALocal = async ({ texto, nodes = [], edges = [], alProgresar }) => {
  const directo = interpretar(texto);
  if (directo.operaciones.length && !directo.noEntendidas.length) {
    return { ...aplicarOperaciones(directo.operaciones, { nodes, edges }), motor: 'interprete', noEntendidas: [], modeloDisponible: true };
  }

  const nivel = await nivelActual();
  const config = await modeloTextoActual();
  let errorModelo = null;

  // 1) Ollama instalado en el equipo: modelos más grandes, ya descargados y con la gráfica del sistema
  const { motorTexto = 'auto', modeloOllama } = preferenciasIA();
  if (motorTexto !== 'navegador') {
    const ollama = await estadoOllama();
    const modelo = modeloOllama && ollama.modelos.some((m) => m.nombre === modeloOllama)
      ? modeloOllama
      : modeloOllamaPorDefecto(ollama.modelos);
    if (ollama.disponible && modelo) {
      try {
        const respuesta = await generarConOllama(construirMensajes(texto, nodes, edges), modelo);
        const traducido = interpretar(limpiarRespuesta(respuesta));
        if (traducido.operaciones.length) {
          const operaciones = sinAsociacionesRepetidas(traducido.operaciones);
          return {
            ...aplicarOperaciones(operaciones, { nodes, edges }),
            motor: 'ollama',
            modeloUsado: modelo,
            ordenes: limpiarRespuesta(respuesta),
            noEntendidas: traducido.noEntendidas,
            modeloDisponible: true,
          };
        }
      } catch (error) {
        errorModelo = error.message;
      }
    }
  }

  // 2) Modelo dentro del navegador
  if (config && await modeloDescargado(config)) {
    try {
      const respuesta = await generarTexto(construirMensajes(texto, nodes, edges), config, alProgresar);
      const ordenes = limpiarRespuesta(respuesta);
      const traducido = interpretar(ordenes);
      if (traducido.operaciones.length) {
        const operaciones = sinAsociacionesRepetidas(traducido.operaciones);
        return { ...aplicarOperaciones(operaciones, { nodes, edges }), motor: 'modelo', ordenes, noEntendidas: traducido.noEntendidas, modeloDisponible: true };
      }
    } catch (error) {
      errorModelo = error.message;
    }
  }

  const base = directo.operaciones.length
    ? aplicarOperaciones(directo.operaciones, { nodes, edges })
    : { nodes, edges, cambios: 0, resumen: [], avisos: [] };
  return {
    ...base,
    motor: 'interprete',
    noEntendidas: directo.noEntendidas,
    errorModelo,
    modeloDisponible: Boolean(config && await modeloDescargado(config)),
    nivel,
  };
};

/** Separa "data:image/png;base64,AAAA" en lo que Ollama espera recibir. */
const soloBase64 = (dato) => String(dato || '').replace(/^data:[^;]+;base64,/, '');

/**
 * Lee la foto de un diagrama con un modelo con vista de Ollama, sin internet.
 *
 * Devuelve `{ disponible: false, motivo }` cuando no hay Ollama o no hay ningún modelo que
 * acepte imágenes, para que quien llame pueda explicarlo en lugar de fallar.
 *
 * Aviso honesto: un modelo local de 4B o 7B lee bien los nombres de las clases y sus
 * atributos, pero se equivoca seguido con las relaciones y las cardinalidades. Sirve para
 * adelantar el trabajo sin conexión; con internet, la IA de la nube lee mucho mejor.
 */
export const leerImagenConIALocal = async ({ imagen, texto = '', nodes = [], edges = [] }) => {
  const { motorTexto = 'auto', modeloVistaOllama } = preferenciasIA();
  if (motorTexto === 'navegador') {
    return { disponible: false, motivo: 'La lectura de imágenes sin conexión usa Ollama, y está desactivado en las preferencias.' };
  }
  const ollama = await estadoOllama();
  if (!ollama.disponible) {
    return { disponible: false, motivo: 'Para leer imágenes sin conexión hace falta Ollama en este equipo.', bloqueoDelNavegador: ollama.bloqueoDelNavegador };
  }
  const elegido = modeloVistaOllama && ollama.modelos.some((m) => m.nombre === modeloVistaOllama)
    ? modeloVistaOllama
    : await modeloVistaPorDefecto(ollama.modelos);
  if (!elegido) {
    return { disponible: false, motivo: 'Ninguno de los modelos instalados en Ollama lee imágenes. Descarga uno con vista, por ejemplo: ollama pull qwen2.5vl:7b' };
  }
  const mensajes = construirMensajesImagen(soloBase64(imagen), nodes, edges, texto);
  const respuesta = await generarConOllama(mensajes, elegido, { maxTokens: 900 });
  const ordenes = limpiarRespuesta(respuesta);
  const traducido = interpretar(ordenes);
  if (!traducido.operaciones.length) {
    return { disponible: true, modeloUsado: elegido, ordenes, cambios: 0, nodes, edges, resumen: [], avisos: [],
      motivo: 'El modelo no reconoció clases en la imagen. Prueba con una foto más nítida o recorta el diagrama.' };
  }
  const operaciones = sinAsociacionesRepetidas(traducido.operaciones);
  return {
    ...aplicarOperaciones(operaciones, { nodes, edges }),
    disponible: true,
    motor: 'ollama-vista',
    modeloUsado: elegido,
    ordenes,
    noEntendidas: traducido.noEntendidas,
  };
};

/** Transcribe con Whisper local; null si el modelo de voz aún no se descargó. */
export const transcribirConIALocal = async (blob, alProgresar) => {
  const config = await modeloVozActual();
  if (!(await modeloDescargado(config))) return null;
  return transcribirAudio(blob, config, alProgresar);
};
