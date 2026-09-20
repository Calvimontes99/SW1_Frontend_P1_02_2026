/**
 * Mensajes de error para el usuario: convierte respuestas fallidas del servidor y errores técnicos
 * (red, JSON, códigos HTTP, mensajes en inglés) en textos claros en español. El detalle técnico
 * se sigue viendo en la consola del navegador.
 */

// Rastros de un error técnico que no debe verse en pantalla
const TECNICO = /\b(undefined|null|NaN|TypeError|ReferenceError|SyntaxError|RangeError|Exception|ECONN\w*|ETIMEDOUT|stack|fetch failed|Failed to fetch|NetworkError|Unexpected (token|end)|is not (a function|defined|valid JSON|iterable)|Cannot (read|set|find)|status code|AI server error|backend error|GoogleGenerativeAI)\b|https?:\/\/|\[\d{3}[ \]]|\b[45]\d\d\b/i;
// Mensajes escritos en inglés (librerías, código antiguo)
const INGLES = /\b(the|is|are|was|not|failed|invalid|required|found|with|from|please|unauthorized|forbidden|missing|unable|could)\b/i;

export const esMensajeParaUsuario = (texto) =>
  typeof texto === 'string' && texto.trim().length > 0 && texto.length <= 300 && !TECNICO.test(texto) && !INGLES.test(texto);

const SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión a internet. Si el servidor estaba inactivo, puede tardar hasta un minuto en despertar: espera un momento y vuelve a intentar.';

const POR_ESTADO = {
  400: 'Los datos enviados no son válidos. Revisa la información e intenta de nuevo.',
  401: 'Tu sesión no está iniciada o expiró. Inicia sesión de nuevo.',
  403: 'No tienes permiso para realizar esta acción.',
  404: 'No se encontró lo que buscabas. Es posible que se haya eliminado.',
  405: 'Esta acción ya no está disponible.',
  408: 'El servidor tardó demasiado en responder. Intenta de nuevo.',
  409: 'Ya existe un registro con esos datos.',
  413: 'Lo que intentas enviar es demasiado grande. Prueba con un archivo o diagrama más pequeño.',
  429: 'Se hicieron demasiadas solicitudes seguidas. Espera un momento e intenta de nuevo.',
  500: 'Ocurrió un problema en el servidor. Intenta de nuevo en unos segundos.',
  502: 'El servidor no está disponible en este momento o se está iniciando. Espera un minuto y vuelve a intentar.',
  503: 'El servidor no está disponible en este momento o se está iniciando. Espera un minuto y vuelve a intentar.',
  504: 'El servidor tardó demasiado en responder. Espera un momento y vuelve a intentar.',
};

/** Lee el cuerpo de una respuesta como JSON sin fallar (null si no es JSON). */
export const leerJSON = async (res) => {
  try {
    const texto = await res.clone().text();
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
};

/** Motivo que manda el servidor, en cualquiera de sus formatos de respuesta, si es legible. */
export const motivoDelServidor = (cuerpo) => {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const candidatos = [
    cuerpo.message,
    cuerpo.data?.message,
    cuerpo.error,
    cuerpo.data?.error,
    Array.isArray(cuerpo.messages) ? cuerpo.messages.join('. ') : null,
  ];
  return candidatos.find((c) => esMensajeParaUsuario(c)) || null;
};

/** Error con un mensaje claro a partir de una respuesta fallida (res.ok === false). */
export const errorDeRespuesta = (res, cuerpo, porDefecto = 'No se pudo completar la operación.') => {
  const error = new Error(motivoDelServidor(cuerpo) || POR_ESTADO[res.status] || porDefecto);
  error.status = res.status;
  error.paraUsuario = true;
  return error;
};

/** Mensaje claro para cualquier error atrapado en un catch. */
export const mensajeDeError = (error, porDefecto = 'Ocurrió un problema inesperado. Intenta de nuevo.') => {
  const texto = error?.message || (typeof error === 'string' ? error : '');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'No hay conexión a internet. Revisa tu conexión; mientras tanto, la IA local sigue disponible.';
  }
  if (error?.name === 'AbortError' || /timeout|timed out|tardó demasiado/i.test(texto)) {
    return error?.paraUsuario ? texto : 'La operación tardó demasiado. Intenta de nuevo.';
  }
  if (/Failed to fetch|fetch failed|NetworkError|Load failed|network error/i.test(texto)) return SIN_CONEXION;
  // Micrófono y cámara (getUserMedia)
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'El navegador no dio permiso para usar el micrófono. Actívalo desde el candado de la barra de direcciones y vuelve a intentar.';
  }
  if (error?.name === 'NotFoundError') return 'No se encontró ningún micrófono conectado.';
  if (error?.name === 'NotReadableError') return 'El micrófono está siendo usado por otra aplicación. Ciérrala y vuelve a intentar.';
  if (error?.paraUsuario || esMensajeParaUsuario(texto)) return texto;
  return porDefecto;
};
