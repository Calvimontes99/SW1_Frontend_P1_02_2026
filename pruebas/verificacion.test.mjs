// Escenarios de la verificación del 15/10 (auditoria-2026-10-15/README.md, V2 a V5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sincronia, MAX_POR_TANDA } from '../src/utils/sincronia.js';
import { aplicarOps } from '../src/utils/operacionesDiagrama.js';
import { cursorParaReanudar, fusionarPorId } from '../src/utils/fusionHistorial.js';
import { montarSocketFlow } from './hookSimulado.mjs';

const clase = (id, nombre = id, x = 0) => ({ id, type: 'classNode', position: { x, y: 0 }, data: { className: nombre, attributes: [], methods: [] } });
const nombres = (estado) => estado.nodes.map((n) => n.data.className);

test('V2) una tanda de la versión anterior que el servidor ya aplicó no se repite sobre trabajo posterior', () => {
  // La copia vieja renombraba A a "Viejo"; después otra persona la renombró a "Nuevo"
  const s = new Sincronia({ confirmado: { nodes: [clase('A')], edges: [] }, pendientes: [{ id: 'tanda-vieja', ops: [{ op: 'ponerNodo', nodo: clase('A', 'Viejo') }] }] });
  assert.equal(s.siguiente(), null, 'no se envía hasta saber si el servidor ya la tenía');
  s.estadoServidor({ nodes: [clase('A', 'Nuevo')], edges: [] }, ['tanda-vieja']);
  assert.equal(s.hayPendientes(), false);
  assert.deepEqual(nombres(s.vista()), ['Nuevo']);
  assert.equal(s.descartadasLegado, 0);
});

test('V2b) si el servidor no la reconoce, solo se conserva lo que crea elementos nuevos (lo demás se descarta y se cuenta)', () => {
  const s = new Sincronia({
    confirmado: { nodes: [clase('A')], edges: [] },
    pendientes: [{ id: 'tanda-vieja', ops: [{ op: 'ponerNodo', nodo: clase('A', 'Viejo') }, { op: 'ponerNodo', nodo: clase('B') }, { op: 'quitarNodo', id: 'A' }] }],
  });
  s.estadoServidor({ nodes: [clase('A', 'Nuevo')], edges: [] }, []);
  assert.equal(s.descartadasLegado, 2, 'el renombre y el borrado de A son inciertos');
  assert.deepEqual(nombres(s.vista()).sort(), ['B', 'Nuevo']);
  const lote = s.siguiente();
  assert.match(lote.id, /^.+:\d+$/, 'lo conservado sale con la numeración nueva');
  assert.deepEqual(lote.ops.map((o) => o.nodo.id), ['B']);
});

test('V3) una tanda vieja de más de 500 operaciones se divide al migrarla (el servidor no la rechaza entera)', () => {
  const ops = Array.from({ length: 2001 }, (_, i) => ({ op: 'ponerNodo', nodo: clase(`N${i}`) }));
  const s = new Sincronia({ pendientes: [{ id: 'enorme-sin-numero', ops }] });
  s.estadoServidor({ nodes: [], edges: [] }, []);
  assert.ok(s.pendientes.length >= 5);
  assert.ok(s.pendientes.every((l) => l.ops.length <= MAX_POR_TANDA && /^.+:\d+$/.test(l.id)));
  assert.equal(s.pendientes.reduce((n, l) => n + l.ops.length, 0), 2001, 'nada se pierde');
  // Se envían todas, en orden, hasta vaciar la cola
  let servidor = { nodes: [], edges: [] };
  for (let lote = s.siguiente(); lote; lote = s.siguiente()) { servidor = aplicarOps(servidor, lote.ops); s.confirmar(lote.id); }
  assert.equal(servidor.nodes.length, 2001);
});

test('V4) al reconectar se vuelve a pedir un mensaje de la IA cuya propuesta todavía no tenía id', () => {
  const mensajes = [
    { id: 98, tipo: 'usuario', texto: 'Agrega A' },
    { id: 100, tipo: 'ia', datos: { propuesta: { estado: 'pendiente' } } },
    { id: 101, tipo: 'usuario', texto: 'Gracias' },
  ];
  assert.equal(cursorParaReanudar(mensajes), 99);
  mensajes[1].datos.propuesta.id = 7;
  assert.equal(cursorParaReanudar(mensajes), 101, 'completo: desde el último');
  assert.equal(cursorParaReanudar([]), undefined);
  // La versión que llega reemplaza la incompleta
  const nuevos = fusionarPorId([{ id: 100, datos: { propuesta: {} } }], [{ id: 100, datos: { propuesta: { id: 7 } } }]);
  assert.equal(nuevos[0].datos.propuesta.id, 7);
});

test('V5) "Guardar" sigue cuando la reconexión informa que el servidor ya tenía todo (sin la confirmación perdida)', async () => {
  const h = montarSocketFlow({ inicial: { nodes: [clase('A', 'Inicial')], edges: [] } });
  h.hook.setNodes([clase('A', 'Editada')]);
  h.correr(50); // sale la tanda; el servidor la aplica pero la confirmación se pierde
  const guardado = h.hook.guardarEstado();
  h.handlers.get('disconnect')();
  h.handlers.get('connect')();
  h.handlers.get('estadoInicial')({ state: h.servidor, aplicados: [h.lotes[0].lote.id] });
  await new Promise((r) => setImmediate(r));
  const respuesta = await guardado; // sin correr el límite de 8 s
  assert.equal(respuesta.success, true);
  assert.equal(h.persistido.nodes[0].data.className, 'Editada');
  assert.equal(h.local.pendientes.length, 0);
});

test('V5b) si quitan el acceso o se cierra el tablero, "Guardar" termina enseguida (no espera el límite)', async () => {
  const h = montarSocketFlow({ inicial: { nodes: [clase('A')], edges: [] } });
  h.hook.setNodes([clase('A', 'Sin confirmar')]);
  h.correr(50);
  const revocado = h.hook.guardarEstado();
  h.handlers.get('accesoRevocado')({ mensaje: 'Te quitaron del tablero' });
  assert.equal((await revocado).success, false);
  assert.equal(h.persistido, null);

  const otro = montarSocketFlow({ inicial: { nodes: [clase('A')], edges: [] } });
  otro.hook.setNodes([clase('A', 'Sin confirmar')]);
  otro.correr(50);
  const cerrado = otro.hook.guardarEstado();
  otro.limpiezas.forEach((f) => f());
  assert.equal((await cerrado).success, false);
});
