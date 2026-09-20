/**
 * IA local con Ollama instalado en el equipo (http://localhost:11434).
 *
 * Frente al modelo dentro del navegador tiene tres ventajas: los modelos se descargan una
 * sola vez en la PC (no en cada navegador ni en cada perfil), usan la tarjeta gráfica
 * dedicada con sus controladores, y pueden ser mucho más grandes (7B o más).
 *
 * Para que la app pueda hablarle desde su dirección de internet, Ollama tiene que permitir
 * ese origen con la variable OLLAMA_ORIGINS; si se usa la app desde localhost no hace falta.
 */

export const URL_OLLAMA = 'http://localhost:11434';

let ultimaRevision = { cuando: 0, estado: null };

const consultar = async (ruta, opciones = {}, milisegundos = 2500) => {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), milisegundos);
  try {
    return await fetch(`${URL_OLLAMA}${ruta}`, { ...opciones, signal: control.signal });
  } finally {
    clearTimeout(reloj);
  }
};

/**
 * ¿Hay un Ollama escuchando en este equipo? Devuelve también los modelos instalados.
 * El resultado se recuerda unos segundos para no consultar en cada pulsación.
 */
export const estadoOllama = async ({ forzar = false } = {}) => {
  if (!forzar && ultimaRevision.estado && Date.now() - ultimaRevision.cuando < 15000) return ultimaRevision.estado;
  let estado;
  try {
    const respuesta = await consultar('/api/tags');
    if (!respuesta.ok) {
      estado = { disponible: false, modelos: [], motivo: `Ollama respondió ${respuesta.status}` };
    } else {
      const datos = await respuesta.json();
      const modelos = (datos.models || []).map((m) => ({
        nombre: m.name,
        mb: Math.round((m.size || 0) / 1048576),
        familia: m.details?.family || '',
      }));
      estado = { disponible: true, modelos, motivo: null };
    }
  } catch (error) {
    // AbortError = no contesta nadie; TypeError = el navegador bloqueó la petición
    estado = {
      disponible: false,
      modelos: [],
      motivo: error.name === 'AbortError' ? 'No respondió a tiempo' : 'No se pudo conectar',
    };
  }
  ultimaRevision = { cuando: Date.now(), estado };
  return estado;
};

export const olvidarEstadoOllama = () => { ultimaRevision = { cuando: 0, estado: null }; };

/** Elige el modelo instalado más adecuado: se prefieren los de instrucciones o código. */
export const modeloOllamaPorDefecto = (modelos = []) => {
  if (!modelos.length) return null;
  const preferido = modelos.find((m) => /instruct|coder|llama3|qwen|mistral|phi/i.test(m.nombre));
  return (preferido || modelos[0]).nombre;
};

/** Genera texto con Ollama. Los mensajes son los mismos que usa el modelo del navegador. */
export const generarConOllama = async (mensajes, modelo, { temperatura = 0.2, maxTokens = 512 } = {}) => {
  const respuesta = await consultar('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      messages: mensajes,
      stream: false,
      options: { temperature: temperatura, num_predict: maxTokens },
    }),
  }, 120000);
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`Ollama no pudo responder (${respuesta.status}). ${detalle.slice(0, 120)}`);
  }
  const datos = await respuesta.json();
  return datos.message?.content || '';
};
