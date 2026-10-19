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

/** Copia antigua (antes de las tandas con id): { nodes, edges, ... } o null */
export const leerTableroLocal = (id) => (id ? leerJSON(PREFIJO + id) : null);

// ───── Copia por pestaña: el estado confirmado por el servidor y las tandas propias sin confirmar ─────
// Cada pestaña guarda lo suyo (dos pestañas del mismo tablero no se pisan las pendientes). Una
// pestaña que se cerró con cambios sin enviar deja su copia; la próxima pestaña que abra el tablero
// la adopta y reenvía esas tandas (el servidor descarta las que ya había aplicado).

const PESTANA = 'sesion.pestana';
const ABANDONADA_MS = 15000;

/** Identificador de esta pestaña (sobrevive a recargar, no a cerrar la pestaña). */
export const idPestana = () => {
  try {
    let id = sessionStorage.getItem(PESTANA);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(PESTANA, id);
    }
    return id;
  } catch {
    return 'unica';
  }
};

const claveSincronia = (tablero, pestana) => `${PREFIJO}${tablero}.${pestana}`;

/**
 * Lo que esta pestaña debe cargar:
 *  - la base confirmada: la propia; si no hay, la copia MÁS RECIENTE de otra pestaña aunque no
 *    tenga pendientes (sin conexión es lo único que hay; antes se borraba y el tablero abría vacío);
 *  - las tandas pendientes propias y las de pestañas ya cerradas (se adoptan para reenviarlas).
 * No borra nada: devuelve qué copias se pueden quitar, y el que llama las quita solo DESPUÉS de
 * guardar la suya (si guardar falla, las copias siguen ahí).
 * @returns {{confirmado, pendientes, clienteId?, siguienteSeq?, quitables: string[]} | null}
 */
export const leerSincronia = (tablero) => {
  if (!tablero) return null;
  const clavePropia = claveSincronia(tablero, idPestana());
  const propia = leerJSON(clavePropia);
  const otras = [];
  try {
    const prefijo = `${PREFIJO}${tablero}.`;
    for (let i = 0; i < localStorage.length; i += 1) {
      const clave = localStorage.key(i);
      if (!clave || !clave.startsWith(prefijo) || clave === clavePropia) continue;
      const datos = leerJSON(clave);
      if (datos && datos.confirmado) otras.push({ clave, datos });
    }
  } catch { /* almacenamiento bloqueado */ }
  otras.sort((a, b) => (b.datos.actualizado || 0) - (a.datos.actualizado || 0));
  const base = propia || otras[0]?.datos || null;
  if (!base) {
    // Copia del formato anterior: su contenido se muestra mientras llega el servidor, sin reenviar nada
    const vieja = leerTableroLocal(tablero);
    return vieja ? { confirmado: { nodes: vieja.nodes || [], edges: vieja.edges || [] }, pendientes: [], quitables: [] } : null;
  }
  const ahora = Date.now();
  const abandonadas = otras.filter((o) => ahora - (o.datos.actualizado || 0) >= ABANDONADA_MS);
  // Las tandas de pestañas cerradas van primero (son anteriores) y después las propias
  const pendientes = [];
  for (const o of [...abandonadas].reverse()) {
    for (const l of o.datos.pendientes || []) if (!pendientes.some((p) => p.id === l.id)) pendientes.push(l);
  }
  for (const l of propia?.pendientes || []) if (!pendientes.some((p) => p.id === l.id)) pendientes.push(l);
  // Se pueden quitar las copias cerradas cuyo contenido ya queda en la de esta pestaña
  const actualizadoBase = base.actualizado || 0;
  const quitables = abandonadas
    .filter((o) => (o.datos.pendientes || []).length > 0 || (o.datos.actualizado || 0) <= actualizadoBase)
    .map((o) => o.clave);
  return {
    confirmado: base.confirmado,
    pendientes,
    // La identidad (y la numeración) de tandas es de cada pestaña: nunca se reusa la de otra
    clienteId: propia?.clienteId,
    siguienteSeq: propia?.siguienteSeq,
    quitables,
  };
};

/** @returns {boolean} si se pudo escribir (si no, no se debe borrar ninguna otra copia) */
export const guardarSincronia = (tablero, { confirmado, pendientes, clienteId, siguienteSeq }) => {
  if (!tablero) return false;
  return escribirJSON(claveSincronia(tablero, idPestana()), { confirmado, pendientes, clienteId, siguienteSeq, actualizado: Date.now() });
};

/** Quita la copia de otra pestaña (sus tandas ya pasaron a esta). */
export const olvidarCopia = (clave) => { try { localStorage.removeItem(clave); } catch { /* noop */ } };

export const guardarUsuarioLocal = (usuario) => { if (usuario) escribirJSON(USUARIO, usuario); };
export const leerUsuarioLocal = () => leerJSON(USUARIO);
export const borrarUsuarioLocal = () => { try { localStorage.removeItem(USUARIO); } catch { /* noop */ } };

export const guardarListaLocal = (tableros) => escribirJSON(LISTA, tableros);
export const leerListaLocal = () => leerJSON(LISTA) || [];

/** Un fetch que falló por red (no por respuesta del servidor). */
export const esErrorDeRed = (error) => error instanceof TypeError || error?.name === 'AbortError';
