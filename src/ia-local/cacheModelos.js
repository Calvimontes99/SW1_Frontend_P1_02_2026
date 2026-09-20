/**
 * Caché de los modelos de IA en el sistema de archivos privado del navegador (OPFS).
 *
 * Cache Storage no pudo guardar el archivo de pesos de ~2 GB del modelo de lenguaje
 * ("Unexpected internal error") y el modelo no quedaba disponible sin internet. OPFS
 * escribe por streaming y admite archivos de varios GB. Implementa match/put, que es
 * lo que transformers.js pide a una caché personalizada (env.customCache).
 */

const CARPETA = 'modelos-ia';

export const opfsDisponible = () =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

/** Nombre de archivo estable para una URL (OPFS no admite "/" ni ":"). */
const nombreDe = (clave) => String(clave)
  .replace(/^https?:\/\//, '')
  .replace(/[^A-Za-z0-9._-]/g, '_')
  .slice(-200);

const carpeta = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(CARPETA, { create: true });

/** Escribe el cuerpo de la respuesta en un archivo, trozo a trozo. */
const escribir = async (manejador, respuesta) => {
  if (typeof manejador.createWritable === 'function') {
    const escritor = await manejador.createWritable();
    await respuesta.body.pipeTo(escritor); // pipeTo cierra el escritor
    return;
  }
  // Workers sin createWritable: acceso síncrono
  const acceso = await manejador.createSyncAccessHandle();
  try {
    acceso.truncate(0);
    const lector = respuesta.body.getReader();
    let posicion = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      acceso.write(value, { at: posicion });
      posicion += value.byteLength;
    }
    acceso.flush();
  } finally {
    acceso.close();
  }
};

export const cacheOPFS = {
  async match(clave) {
    try {
      const archivo = await (await (await carpeta()).getFileHandle(nombreDe(clave))).getFile();
      return new Response(archivo, { headers: { 'content-length': String(archivo.size) } });
    } catch {
      return undefined;
    }
  },

  async put(clave, respuesta) {
    const dir = await carpeta();
    const nombre = nombreDe(clave);
    // Se escribe con otro nombre y se renombra al terminar: una descarga cortada
    // no deja un archivo incompleto que luego parezca válido
    if (typeof FileSystemFileHandle !== 'undefined' && 'move' in FileSystemFileHandle.prototype) {
      const temporal = await dir.getFileHandle(`${nombre}.parcial`, { create: true });
      await escribir(temporal, respuesta);
      await temporal.move(nombre);
    } else {
      await escribir(await dir.getFileHandle(nombre, { create: true }), respuesta);
    }
  },
};

/** URL con la que transformers.js pide cada archivo de un modelo de Hugging Face. */
export const urlDeModelo = (id, archivo) => `https://huggingface.co/${id}/resolve/main/${archivo}`;

export const archivoEnOPFS = async (url) => {
  try {
    await (await carpeta()).getFileHandle(nombreDe(url));
    return true;
  } catch {
    return false;
  }
};
