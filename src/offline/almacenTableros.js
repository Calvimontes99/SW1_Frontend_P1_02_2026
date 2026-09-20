/**
 * Copia local de los tableros para seguir trabajando sin conexión.
 *
 * Cada cambio del diagrama se guarda en el navegador. Si se hizo sin conexión con
 * el servidor queda marcado como pendiente y se envía al reconectar.
 */

const PREFIJO = 'tablero.local.';
const USUARIO = 'sesion.usuario';
const LISTA = 'tableros.lista';

const leerJSON = (clave) => {
  try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; }
};
const escribirJSON = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false; // cuota llena o almacenamiento bloqueado
  }
};

/** { nodes, edges, actualizado, pendiente } o null */
export const leerTableroLocal = (id) => (id ? leerJSON(PREFIJO + id) : null);

export const guardarTableroLocal = (id, { nodes, edges }, { pendiente }) => {
  if (!id) return;
  const anterior = leerTableroLocal(id);
  escribirJSON(PREFIJO + id, {
    nodes,
    edges,
    actualizado: Date.now(),
    // Un cambio pendiente sigue pendiente hasta que se sincronice
    pendiente: pendiente || (anterior?.pendiente === true && pendiente !== false),
  });
};

export const marcarSincronizado = (id) => {
  const actual = leerTableroLocal(id);
  if (actual) escribirJSON(PREFIJO + id, { ...actual, pendiente: false });
};

export const guardarUsuarioLocal = (usuario) => { if (usuario) escribirJSON(USUARIO, usuario); };
export const leerUsuarioLocal = () => leerJSON(USUARIO);
export const borrarUsuarioLocal = () => { try { localStorage.removeItem(USUARIO); } catch { /* noop */ } };

export const guardarListaLocal = (tableros) => escribirJSON(LISTA, tableros);
export const leerListaLocal = () => leerJSON(LISTA) || [];

/** Un fetch que falló por red (no por respuesta del servidor). */
export const esErrorDeRed = (error) => error instanceof TypeError || error?.name === 'AbortError';
