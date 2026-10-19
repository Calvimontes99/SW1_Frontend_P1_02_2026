// Casos adicionales a la sección 11. Usan los módulos actuales, sin React,
// red, base de datos ni servicios de IA. Forman parte de npm test.
// Desde frontend/: node --test pruebas/revision-recuperacion.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sincronia } from '../src/utils/sincronia.js';
import { aplicarOps } from '../src/utils/operacionesDiagrama.js';

const clase = (id, nombre) => ({
  id,
  type: 'classNode',
  position: { x: 0, y: 0 },
  data: { className: nombre, attributes: [], methods: [] },
});

test('conserva la edición offline posterior a una tanda aplicada cuyo ACK se perdió', () => {
  const inicial = { nodes: [clase('A', 'Inicial')], edges: [] };
  const cliente = new Sincronia({ confirmado: inicial });
  cliente.local([{ op: 'ponerNodo', nodo: clase('A', 'Enviado') }]);
  // El servidor recibe una copia, la aplica y recuerda el ID; su ACK no llega.
  const enviada = structuredClone(cliente.siguiente());
  const servidor = aplicarOps(inicial, enviada.ops);
  cliente.desconectado();

  // Esta segunda edición nunca llegó al servidor.
  cliente.local([{ op: 'ponerNodo', nodo: clase('A', 'Editado sin conexion') }]);
  assert.equal(cliente.vista().nodes[0].data.className, 'Editado sin conexion');

  // Al volver, el servidor informa únicamente la tanda que recibió antes del corte.
  cliente.estadoServidor(servidor, [enviada.id]);
  assert.equal(
    cliente.vista().nodes[0].data.className,
    'Editado sin conexion',
    'Reconocer la tanda anterior no debe descartar una edición posterior nunca enviada',
  );
  assert.equal(cliente.hayPendientes(), true);
});

test('crear A, conectar A-B y renombrar A conserva la relación al agrupar la tanda', () => {
  const inicial = { nodes: [clase('B', 'Clase B')], edges: [] };
  const cliente = new Sincronia({ confirmado: inicial });
  cliente.local([{ op: 'ponerNodo', nodo: clase('A', 'Clase A') }]);
  cliente.local([{
    op: 'ponerArista',
    arista: { id: 'AB', source: 'A', target: 'B', type: 'umlEdge', data: { type: 'Association' } },
  }]);
  assert.equal(cliente.vista().edges.length, 1);

  cliente.local([{ op: 'ponerNodo', nodo: clase('A', 'Clase A renombrada') }]);
  const lote = cliente.siguiente();
  const servidor = aplicarOps(inicial, lote.ops);
  assert.deepEqual(
    servidor.edges.map((e) => e.id),
    ['AB'],
    `Renombrar no debe eliminar la relación; orden agrupado: ${lote.ops.map((o) => o.op).join(', ')}`,
  );
});
