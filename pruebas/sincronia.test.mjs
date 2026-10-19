// Pruebas de la sincronización del tablero (npm test, desde frontend/).
// Reproducen los casos de la revisión con un servidor simulado que entrega los mensajes en el
// mismo orden que Socket.IO: por conexión, en el orden en que el servidor los procesó.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sincronia } from '../src/utils/sincronia.js';
import { aplicarOps, opsEntre } from '../src/utils/operacionesDiagrama.js';
import { deshacerSelectivo } from '../src/utils/deshacerSelectivo.js';

const clase = (id, nombre, attrs = [], x = 0) => ({ id, type: 'classNode', position: { x, y: 0 }, data: { className: nombre, attributes: attrs, methods: [] } });
const nombres = (estado) => estado.nodes.map((n) => `${n.id}:${n.data.className}:${n.data.attributes.join('|')}`).sort();

/** Servidor de mentira: aplica tandas en orden, descarta repetidas y reparte a cada cliente. */
class ServidorSimulado {
  constructor(estado) {
    this.estado = estado;
    this.lotes = new Set();
    this.buzones = new Map(); // cliente → mensajes en orden de llegada
  }
  conectar(nombre) { this.buzones.set(nombre, []); }
  recibir(nombre, lote) {
    if (this.lotes.has(lote.id)) { this.buzones.get(nombre).push({ tipo: 'ack', id: lote.id, duplicado: true }); return; }
    this.estado = aplicarOps(this.estado, lote.ops);
    this.lotes.add(lote.id);
    for (const [otro, buzon] of this.buzones) {
      buzon.push(otro === nombre ? { tipo: 'ack', id: lote.id } : { tipo: 'ops', ops: lote.ops });
    }
  }
  /** Entrega lo pendiente de un cliente a su núcleo de sincronía. */
  entregar(nombre, sync) {
    const buzon = this.buzones.get(nombre);
    while (buzon.length) {
      const m = buzon.shift();
      if (m.tipo === 'ack') sync.confirmar(m.id, { duplicado: !!m.duplicado });
      else sync.remotas(m.ops);
    }
  }
  unirse(nombre, sync) {
    this.conectar(nombre);
    const aplicados = sync.pendientes.map((l) => l.id).filter((id) => this.lotes.has(id));
    sync.estadoServidor(this.estado, aplicados);
  }
}

const editarLocal = (sync, cambiar) => {
  const antes = sync.vista();
  sync.local(opsEntre(antes, cambiar(antes)));
};

test('1) abrir con una copia vieja sin pendientes no pisa la versión del servidor', () => {
  const copiaVieja = { confirmado: { nodes: [clase('A', 'Cliente', ['id'])], edges: [] }, pendientes: [] };
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente', ['id', 'email']), clase('B', 'Venta')], edges: [] });
  const sync = new Sincronia(copiaVieja);
  assert.deepEqual(nombres(sync.vista()), ['A:Cliente:id']); // se muestra mientras llega el servidor
  servidor.unirse('yo', sync);
  assert.equal(sync.hayPendientes(), false, 'la carga no genera operaciones');
  assert.equal(sync.siguiente(), null);
  assert.deepEqual(nombres(sync.vista()), nombres(servidor.estado));
});

test('2) dos personas editan el mismo nodo a la vez: todos terminan viendo lo que dejó el servidor', () => {
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente', ['id'])], edges: [] });
  const a = new Sincronia(); const b = new Sincronia();
  servidor.unirse('A', a); servidor.unirse('B', b);
  editarLocal(a, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['id', 'de A'])] }));
  editarLocal(b, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['id', 'de B'])] }));
  const loteA = a.siguiente(); const loteB = b.siguiente();
  servidor.recibir('A', loteA); // el servidor procesa A y después B
  servidor.recibir('B', loteB);
  servidor.entregar('A', a); servidor.entregar('B', b);
  assert.deepEqual(nombres(servidor.estado), ['A:Cliente:id|de B']);
  assert.deepEqual(nombres(a.vista()), nombres(servidor.estado));
  assert.deepEqual(nombres(b.vista()), nombres(servidor.estado), 'B ya no queda mostrando la edición de A');
});

test('2b) mientras espera la confirmación, lo propio se sigue viendo encima de lo ajeno', () => {
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente'), clase('B', 'Venta')], edges: [] });
  const a = new Sincronia(); const b = new Sincronia();
  servidor.unirse('A', a); servidor.unirse('B', b);
  editarLocal(a, (v) => ({ ...v, nodes: v.nodes.map((n) => (n.id === 'A' ? clase('A', 'Cliente', ['mío']) : n)) }));
  const loteA = a.siguiente();
  editarLocal(b, (v) => ({ ...v, nodes: v.nodes.map((n) => (n.id === 'B' ? clase('B', 'Venta', ['de B'], 0) : n)) }));
  servidor.recibir('B', b.siguiente());
  servidor.entregar('A', a); // A recibe lo de B antes de su confirmación
  assert.deepEqual(nombres(a.vista()), ['A:Cliente:mío', 'B:Venta:de B']);
  servidor.recibir('A', loteA);
  servidor.entregar('A', a); servidor.entregar('B', b);
  assert.deepEqual(nombres(a.vista()), nombres(servidor.estado));
  assert.deepEqual(nombres(b.vista()), nombres(servidor.estado));
});

test('3) una tanda ya aplicada no se repite al recargar aunque la copia guardada la tenga', () => {
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente', ['id'])], edges: [] });
  const a = new Sincronia(); const b = new Sincronia();
  servidor.unirse('A', a); servidor.unirse('B', b);
  editarLocal(a, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['id', 'viejo de A'])] }));
  servidor.recibir('A', a.siguiente()); // el servidor la aplica...
  const copiaGuardada = a.serializar(); // ...pero la copia del navegador quedó con la tanda pendiente
  assert.equal(copiaGuardada.pendientes.length, 1);
  // Después, B cambia lo mismo
  servidor.entregar('B', b);
  editarLocal(b, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['id', 'nuevo de B'])] }));
  servidor.recibir('B', b.siguiente());
  // A recarga con la copia vieja y vuelve a entrar
  const recargado = new Sincronia(copiaGuardada);
  servidor.unirse('A', recargado);
  assert.equal(recargado.hayPendientes(), false, 'el servidor avisó que esa tanda ya estaba');
  assert.deepEqual(nombres(recargado.vista()), ['A:Cliente:id|nuevo de B']);
  // Aunque se reenviara, el servidor la descarta por su id
  servidor.recibir('A', copiaGuardada.pendientes[0]);
  assert.deepEqual(nombres(servidor.estado), ['A:Cliente:id|nuevo de B']);
});

test('3b) sin conexión: lo pendiente se aplica sobre el estado del servidor y se envía al volver', () => {
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente'), clase('B', 'Venta')], edges: [] });
  const a = new Sincronia(); const b = new Sincronia();
  servidor.unirse('A', a); servidor.unirse('B', b);
  editarLocal(a, (v) => ({ ...v, nodes: v.nodes.filter((n) => n.id !== 'B') })); // A borra B sin conexión
  a.desconectado();
  editarLocal(b, (v) => ({ ...v, nodes: [...v.nodes, clase('C', 'Producto')] })); // B agrega C
  servidor.recibir('B', b.siguiente());
  servidor.unirse('A', a);
  assert.deepEqual(nombres(a.vista()).map((x) => x.split(':')[0]), ['A', 'C']);
  servidor.recibir('A', a.siguiente());
  servidor.entregar('A', a); servidor.entregar('B', b);
  assert.deepEqual(nombres(servidor.estado).map((x) => x.split(':')[0]), ['A', 'C']);
  assert.deepEqual(nombres(b.vista()), nombres(servidor.estado));
});

test('5) "borrar B" seguido de "crear A→B" no deja una relación colgando', () => {
  const estado = { nodes: [clase('A', 'Cliente'), clase('B', 'Venta')], edges: [] };
  const r = aplicarOps(estado, [{ op: 'quitarNodo', id: 'B' }, { op: 'ponerArista', arista: { id: 'e1', source: 'A', target: 'B', data: {} } }]);
  assert.equal(r.edges.length, 0);
});

test('deshacer selectivo conserva lo que hizo otro después', () => {
  const antes = { nodes: [clase('A', 'Cliente', ['id']), clase('B', 'Venta')], edges: [] };
  const mio = { nodes: [clase('A', 'Cliente', ['id', 'nombre']), clase('B', 'Venta')], edges: [] };
  const ahora = { nodes: [clase('A', 'Cliente', ['id', 'nombre']), clase('B', 'Venta', ['total']), clase('C', 'Producto')], edges: [] };
  const r = deshacerSelectivo(ahora, antes, mio);
  assert.deepEqual(nombres(r.estado), ['A:Cliente:id', 'B:Venta:total', 'C:Producto:']);
});

// ── Casos de recuperación y agrupación (ver también revision-recuperacion.test.mjs) ──

test('una tanda que salió queda sellada: lo nuevo va en otra tanda', () => {
  const sync = new Sincronia({ confirmado: { nodes: [clase('A', 'Cliente')], edges: [] } });
  editarLocal(sync, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['uno'])] }));
  const lote = sync.siguiente();
  sync.desconectado(); // se cortó antes de la confirmación
  editarLocal(sync, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['uno', 'dos'])] }));
  assert.equal(sync.pendientes.length, 2);
  assert.deepEqual(sync.pendientes[0].ops, lote.ops, 'la tanda enviada no cambió');
});

test('confirmación perdida y la tanda NO llegó al servidor: se reenvía y no se pierde nada', () => {
  const servidor = new ServidorSimulado({ nodes: [clase('A', 'Cliente')], edges: [] });
  const sync = new Sincronia();
  servidor.unirse('A', sync);
  editarLocal(sync, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['uno'])] }));
  sync.siguiente(); // salió pero se perdió en el camino
  sync.desconectado();
  editarLocal(sync, (v) => ({ ...v, nodes: [clase('A', 'Cliente', ['uno', 'dos'])] }));
  servidor.unirse('A', sync); // el servidor no la conoce
  assert.equal(sync.pendientes.length, 2);
  servidor.recibir('A', sync.siguiente()); servidor.entregar('A', sync);
  servidor.recibir('A', sync.siguiente()); servidor.entregar('A', sync);
  assert.deepEqual(nombres(servidor.estado), ['A:Cliente:uno|dos']);
  assert.deepEqual(nombres(sync.vista()), nombres(servidor.estado));
});

test('borrar una clase con relación y deshacer en la misma tanda conserva la relación', () => {
  const inicial = { nodes: [clase('A', 'Cliente'), clase('B', 'Venta')], edges: [{ id: 'e1', source: 'A', target: 'B', data: {} }] };
  const sync = new Sincronia({ confirmado: inicial });
  editarLocal(sync, (v) => ({ nodes: v.nodes.filter((n) => n.id !== 'A'), edges: [] }));
  editarLocal(sync, () => inicial); // deshacer antes de que salga la tanda
  const lote = sync.siguiente();
  const r = aplicarOps(inicial, lote.ops);
  assert.deepEqual(r.nodes.map((n) => n.id).sort(), ['A', 'B']);
  assert.deepEqual(r.edges.map((e) => e.id), ['e1']);
});

test('crear, mover, conectar y renombrar antes de enviar: se aplica en un orden válido', () => {
  const inicial = { nodes: [clase('B', 'Venta')], edges: [] };
  const sync = new Sincronia({ confirmado: inicial });
  editarLocal(sync, (v) => ({ ...v, nodes: [...v.nodes, clase('A', 'Cliente')] }));
  editarLocal(sync, (v) => ({ ...v, nodes: v.nodes.map((n) => (n.id === 'A' ? { ...n, position: { x: 50, y: 60 } } : n)) }));
  editarLocal(sync, (v) => ({ ...v, edges: [{ id: 'AB', source: 'A', target: 'B', data: {} }] }));
  editarLocal(sync, (v) => ({ ...v, nodes: v.nodes.map((n) => (n.id === 'A' ? { ...n, data: { ...n.data, className: 'ClienteVip' } } : n)) }));
  const r = aplicarOps(inicial, sync.siguiente().ops);
  const a = r.nodes.find((n) => n.id === 'A');
  assert.equal(a.data.className, 'ClienteVip');
  assert.deepEqual(a.position, { x: 50, y: 60 });
  assert.deepEqual(r.edges.map((e) => e.id), ['AB']);
});
