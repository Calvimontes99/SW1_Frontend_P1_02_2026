// Dos chats por sala: el del equipo y el de la IA (utils/canalesChat.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { anterioresPorCanal, canalDe, mencionaALaIA } from '../src/utils/canalesChat.js';

test('cada mensaje va a su chat: lo de la IA, los avisos y los pedidos a la IA van al chat de la IA', () => {
  assert.equal(canalDe({ tipo: 'usuario', texto: 'hola equipo' }), 'equipo');
  assert.equal(canalDe({ tipo: 'usuario', datos: { paraIA: true } }), 'ia');
  assert.equal(canalDe({ tipo: 'ia' }), 'ia');
  assert.equal(canalDe({ tipo: 'sistema' }), 'ia');
  assert.equal(canalDe({ tipo: 'usuario', canal: 'ia' }), 'ia', 'manda el canal que guardó el servidor');
});

test('mencionar a @IA en el chat del equipo es un pedido a la IA', () => {
  assert.equal(mencionaALaIA('@IA revisa el diagrama'), true);
  assert.equal(mencionaALaIA('oye @ia agrega Cliente'), true);
  assert.equal(mencionaALaIA('la media de ventas'), false);
  assert.equal(mencionaALaIA('correo@ia.com'), false);
});

test('"Cargar anteriores" se decide por chat: uno muy activo no deja sin historial al otro', () => {
  assert.deepEqual(anterioresPorCanal({ hayAnteriores: { equipo: false, ia: true } }), { equipo: false, ia: true });
  // Servidor anterior (sin hayAnteriores): se cuenta por canal
  const mensajes = [
    ...Array.from({ length: 80 }, (_, i) => ({ id: i + 1, tipo: 'ia' })),
    { id: 81, tipo: 'usuario', texto: 'hola' },
  ];
  assert.deepEqual(anterioresPorCanal({ mensajes }), { equipo: false, ia: true });
});
