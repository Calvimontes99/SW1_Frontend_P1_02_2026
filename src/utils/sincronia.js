import { aplicarOps, fusionarOps, limpiar } from './operacionesDiagrama.js';

/**
 * Núcleo de la sincronización del tablero en el cliente (sin React, para poder probarlo).
 *
 * Se separan dos cosas que antes estaban mezcladas:
 *  - `confirmado`: el diagrama tal como lo tiene el servidor (lo último que confirmó);
 *  - `pendientes`: tandas de operaciones propias, con id, que el servidor todavía no confirmó.
 * Lo que se ve es siempre `confirmado` + `pendientes`, y se reconstruye después de cada cosa que
 * llega del servidor. Así, si dos personas editan lo mismo, todos terminan viendo lo que el
 * servidor dejó (el orden del servidor manda) y nadie se queda con una versión distinta.
 *
 * Reglas de orden (Socket.IO entrega en orden por conexión):
 *  - Las operaciones de otros llegan en el orden en que el servidor las aplicó.
 *  - La confirmación de una tanda propia llega después de todo lo que el servidor aplicó antes que
 *    ella, y antes de lo que aplicó después. Por eso, al confirmar, la tanda se suma a `confirmado`
 *    en ese punto exacto.
 *  - Cada tanda se llama "<cliente>:<número>" y los números de un cliente crecen de a uno. El
 *    servidor guarda, con el diagrama, el último número aplicado de cada cliente: si una tanda se
 *    reenvía (reconexión, recarga, aunque hayan pasado miles de tandas de otros), la reconoce y no
 *    la aplica dos veces; al entrar, informa cuáles de las pendientes ya tenía.
 *  - Una tanda tiene como mucho MAX_POR_TANDA operaciones (el servidor rechaza, entera, una más
 *    grande que su máximo, en vez de guardarla recortada).
 */

export const MAX_POR_TANDA = 500;
const ID_NUMERADO = /^.+:\d+$/;
const nuevoCliente = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const vacio = () => ({ nodes: [], edges: [] });

export class Sincronia {
  /**
   * @param {{confirmado?: object, pendientes?: Array<{id: string, ops: object[]}>}} guardado
   *        lo que quedó en el navegador (sin conexión o al recargar)
   */
  constructor(guardado = {}) {
    this.confirmado = guardado.confirmado || vacio();
    // Identidad de este cliente para numerar sus tandas (se guarda con la copia de la pestaña)
    this.clienteId = typeof guardado.clienteId === 'string' && guardado.clienteId ? guardado.clienteId : nuevoCliente();
    this.siguienteSeq = Number.isInteger(guardado.siguienteSeq) && guardado.siguienteSeq > 0 ? guardado.siguienteSeq : 1;
    // Lo que viene guardado pudo haber salido antes de recargar: queda sellado (no se le suman
    // cambios nuevos), porque el servidor puede reconocer ese id y descartarlo entero
    this.pendientes = Array.isArray(guardado.pendientes) ? guardado.pendientes.map((l) => ({ id: l.id, ops: l.ops, sellada: true })) : [];
    // Copias de antes de la numeración por cliente: se conservan con su id original hasta que el
    // servidor diga si ya las aplicó (ver estadoServidor). Renumerarlas a ciegas hacía que una
    // tanda ya guardada se repitiera sobre trabajo posterior.
    for (const lote of this.pendientes) if (!ID_NUMERADO.test(String(lote.id))) lote.legado = true;
    // Cuántas operaciones de copias viejas no se aplicaron por inciertas (para avisar)
    this.descartadasLegado = 0;
    this.enVuelo = null; // id de la tanda enviada que espera confirmación
  }

  /** Lo que se ve: lo confirmado más lo propio sin confirmar. */
  vista() {
    return this.pendientes.reduce((estado, lote) => aplicarOps(estado, lote.ops), this.confirmado);
  }

  /**
   * Cambios del propio usuario. Se juntan con la última tanda solo si esa tanda NUNCA salió: una
   * que ya se envió (aunque se haya cortado la conexión antes de la confirmación) queda sellada,
   * porque el servidor puede tenerla y reconocerla por su id; si se le sumara una edición nueva,
   * al descartarla por repetida se perdería también esa edición.
   */
  local(ops) {
    if (!ops || !ops.length) return;
    const ultima = this.pendientes[this.pendientes.length - 1];
    if (ultima && !ultima.sellada) {
      const juntas = fusionarOps(ultima.ops, ops);
      if (juntas.length <= MAX_POR_TANDA) { ultima.ops = juntas; return; }
      ultima.sellada = true; // llena: lo nuevo va en tandas aparte
    }
    for (let i = 0; i < ops.length; i += MAX_POR_TANDA) {
      this.pendientes.push({ id: this.nuevoIdLote(), ops: ops.slice(i, i + MAX_POR_TANDA), sellada: false });
    }
    // Solo la última puede seguir creciendo
    for (let i = 0; i < this.pendientes.length - 1; i += 1) this.pendientes[i].sellada = true;
  }

  nuevoIdLote() {
    const id = `${this.clienteId}:${this.siguienteSeq}`;
    this.siguienteSeq += 1;
    return id;
  }

  /** La próxima tanda para enviar (una a la vez, en orden), o null. */
  siguiente() {
    if (this.enVuelo) return null;
    const lote = this.pendientes[0];
    // Una tanda de la versión anterior espera a saber si el servidor ya la tenía
    if (!lote || lote.legado) return null;
    lote.sellada = true; // desde que sale, ya no se modifica
    this.enVuelo = lote.id;
    return { id: lote.id, ops: lote.ops };
  }

  /**
   * El servidor confirmó una tanda. `duplicado`: ya la tenía de antes (no se vuelve a sumar,
   * porque el estado del servidor ya la incluye).
   */
  confirmar(id, { duplicado = false } = {}) {
    const i = this.pendientes.findIndex((l) => l.id === id);
    if (i < 0) return;
    const [lote] = this.pendientes.splice(i, 1);
    if (!duplicado) this.confirmado = aplicarOps(this.confirmado, lote.ops);
    if (this.enVuelo === id) this.enVuelo = null;
  }

  /** El servidor no la aplicó (error): queda primera en la cola para reintentar. */
  rechazar(id) {
    if (this.enVuelo === id) this.enVuelo = null;
  }

  /** Se cortó la conexión: lo que estaba en vuelo se reenviará (el servidor descarta duplicados). */
  desconectado() {
    this.enVuelo = null;
  }

  /** Operaciones de otro participante, ya aplicadas por el servidor. */
  remotas(ops) {
    if (ops && ops.length) this.confirmado = aplicarOps(this.confirmado, ops);
  }

  /**
   * Estado completo del servidor (al entrar o reconectar). `aplicados`: ids de tandas de este
   * cliente que el servidor ya incluyó en ese estado; se descartan para no repetirlas.
   */
  estadoServidor(estado, aplicados = []) {
    const yaEstan = new Set(aplicados || []);
    this.confirmado = { nodes: estado?.nodes || [], edges: estado?.edges || [] };
    this.pendientes = this.migrarLegado(this.pendientes.filter((l) => !yaEstan.has(l.id)));
    this.enVuelo = null;
  }

  /**
   * Tandas de la versión anterior que el servidor NO reconoció: no se sabe si se aplicaron. Para no
   * repetir una edición vieja sobre trabajo posterior, solo se conserva lo que CREA elementos que
   * todavía no existen; lo demás (cambiar, mover o borrar algo existente) se descarta y se avisa.
   * Lo conservado se renumera y se divide en tandas de hasta MAX_POR_TANDA, en el mismo orden.
   */
  migrarLegado(pendientes) {
    if (!pendientes.some((l) => l.legado)) return pendientes;
    let base = this.confirmado;
    const resultado = [];
    for (const lote of pendientes) {
      if (!lote.legado) {
        resultado.push(lote);
        base = aplicarOps(base, lote.ops);
        continue;
      }
      const seguras = [];
      for (const op of lote.ops || []) {
        const nuevaClase = op.op === 'ponerNodo' && op.nodo && !base.nodes.some((n) => n.id === op.nodo.id);
        const nuevaRelacion = op.op === 'ponerArista' && op.arista && !base.edges.some((e) => e.id === op.arista.id);
        if (nuevaClase || nuevaRelacion) {
          seguras.push(op);
          base = aplicarOps(base, [op]);
        } else {
          this.descartadasLegado += 1;
        }
      }
      for (let i = 0; i < seguras.length; i += MAX_POR_TANDA) {
        resultado.push({ id: this.nuevoIdLote(), ops: seguras.slice(i, i + MAX_POR_TANDA), sellada: true });
      }
    }
    return resultado;
  }

  hayPendientes() {
    return this.pendientes.length > 0;
  }

  /** Para guardar en el navegador: sin selección ni medidas. */
  serializar() {
    return {
      confirmado: { nodes: this.confirmado.nodes.map(limpiar), edges: this.confirmado.edges.map(limpiar) },
      pendientes: this.pendientes.map((l) => ({ id: l.id, ops: l.ops })),
      clienteId: this.clienteId,
      siguienteSeq: this.siguienteSeq,
    };
  }
}

/**
 * Lleva lo que es solo de esta pantalla (medidas, selección, arrastre) de la vista anterior a la
 * nueva, para que React Flow no pierda la selección ni tenga que volver a medir todo.
 */
export const conservarTransitorios = (anterior, nueva) => {
  const previos = new Map((anterior || []).map((x) => [x.id, x]));
  return (nueva || []).map((x) => {
    const p = previos.get(x.id);
    if (!p) return x;
    const extra = {};
    for (const k of ['measured', 'selected', 'dragging']) if (p[k] !== undefined && x[k] === undefined) extra[k] = p[k];
    return Object.keys(extra).length ? { ...x, ...extra } : x;
  });
};

export default Sincronia;
