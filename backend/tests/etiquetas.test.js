const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

test('etiquetas: permisos, validación, asignación, edición, eliminación y persistencia', async () => {
  const rutas = new Map();
  const archivos = new Map();
  archivos.set('admin-config.json', JSON.stringify({ username: 'admin', passwordHash: require('bcryptjs').hashSync('test-password', 4), coordinators: [] }));
  archivos.set('reservas.json', JSON.stringify([{ id: 1, estado: 'pendiente', usuario: 'Profesor' }]));
  const app = { disable() {}, use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (ruta, ...handlers) => rutas.set(`${method} ${ruta}`, handlers);
  const express = () => app;
  express.json = express.static = () => () => {};
  const fakeFs = {
    existsSync: file => archivos.has(path.basename(file)),
    readFileSync: file => { if (!archivos.has(path.basename(file))) throw new Error('ENOENT'); return archivos.get(path.basename(file)); },
    writeFileSync: (file, data) => archivos.set(path.basename(file), data)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'fs' ? fakeFs : require(name),
    __dirname: path.join(__dirname, '..'), process: { env: { JWT_SECRET: 'test-secret' } }, console, Buffer
  });
  async function call(method, ruta, rol, body = {}, params = {}) {
    const token = rol ? jwt.sign({ rol }, 'test-secret', { issuer: 'calendario-solicitudes' }) : '';
    const req = { headers: { authorization: token }, body, params, query: {}, ip: "test" };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = JSON.parse(JSON.stringify(data)); return this; } };
    const handlers = rutas.get(`${method} ${ruta}`);
    async function run(i) { if (handlers[i]) await handlers[i](req, res, () => run(i + 1)); }
    await run(0); return res;
  }
  for (const rol of [null, 'profesor', 'coordinador']) {
    assert.equal((await call('post', '/etiquetas', rol, { nombre: 'Alejandro', color: '#3b82f6' })).code, 403);
    assert.equal((await call('put', '/etiquetas/:id', rol, {}, { id: 'x' })).code, 403);
    assert.equal((await call('delete', '/etiquetas/:id', rol, {}, { id: 'x' })).code, 403);
    assert.equal((await call('put', '/reservas/:id', rol, { etiquetaId: 'x' }, { id: '1' })).code, 401);
  }
  for (const username of ['superadmin', 'admin']) {
    const login = await call('post', '/login', null, { username, password: 'test-password' });
    assert.equal(login.code, 200);
    assert.equal(login.data.rol, username);
    assert.equal(jwt.verify(login.data.token, 'test-secret', { issuer: 'calendario-solicitudes' }).rol, username);
  }
  const config = JSON.parse(archivos.get('admin-config.json'));
  assert.equal(config.username, 'superadmin');
  assert.equal(config.adminAccount.passwordHash, config.passwordHash);
  for (const [method, route, params] of [
    ['post', '/etiquetas', {}], ['put', '/etiquetas/:id', {id:'x'}], ['delete', '/etiquetas/:id', {id:'x'}],
    ['post', '/bloqueos', {}], ['delete', '/bloqueos/:id', {id:'1'}],
    ['put', '/limites-solicitudes/:fecha', {fecha:'2026-09-11'}], ['delete', '/limites-solicitudes/:fecha', {fecha:'2026-09-11'}],
    ['put', '/limites-dispositivos/:fecha', {fecha:'2026-09-11'}], ['delete', '/limites-dispositivos/:fecha', {fecha:'2026-09-11'}],
    ['delete', '/reservas/:id', {id:'1'}]
  ]) assert.equal((await call(method, route, 'admin', {}, params)).code, 403, route);
  assert.equal((await call('put', '/reservas/:id', 'admin', {estado:'rechazado'}, {id:'1'})).code, 403);
  assert.equal((await call('get', '/feedback', 'admin')).code, 200);
  assert.equal((await call('get', '/reservas/recientes', 'admin')).code, 200);
  assert.equal((await call('get', '/etiquetas', 'profesor')).code, 403);
  assert.equal((await call('post', '/etiquetas', 'superadmin', { nombre: ' ', color: '#ffffff' })).code, 400);
  assert.equal((await call('post', '/etiquetas', 'superadmin', { nombre: 'A', color: 'red' })).code, 400);
  const etiqueta = (await call('post', '/etiquetas', 'superadmin', { nombre: 'Alejandro', color: '#3b82f6' })).data;
  assert.equal((await call('post', '/etiquetas', 'superadmin', { nombre: ' ALEJANDRO ', color: '#ffffff' })).code, 409);
  assert.equal((await call('put', '/reservas/:id', 'superadmin', { etiquetaId: 'inexistente' }, { id: '1' })).code, 400);
  const asignada = await call('put', '/reservas/:id', 'superadmin', { etiquetaId: etiqueta.id }, { id: '1' });
  assert.equal(asignada.data.reserva.estado, 'pendiente');
  assert.equal((await call('put', '/reservas/:id', 'admin', {etiquetaId: etiqueta.id}, {id:'1'})).code, 403);
  assert.equal((await call('put', '/reservas/:id', 'admin', {etiquetaId: null}, {id:'1'})).code, 403);
  for (const rol of [null, 'profesor']) assert.equal((await call('get', '/reservas', rol)).data[0].etiquetaId, undefined);
  for (const rol of ['superadmin', 'admin', 'coordinador']) assert.equal((await call('get', '/reservas', rol)).data[0].etiqueta.nombre, 'Alejandro');
  await call('put', '/etiquetas/:id', 'superadmin', { nombre: 'Andrea', color: '#22c55e' }, { id: etiqueta.id });
  assert.equal((await call('get', '/reservas', 'coordinador')).data[0].etiqueta.nombre, 'Andrea');
  assert.equal(JSON.parse(archivos.get('etiquetas.json'))[0].nombre, 'Andrea');
  await call('put', '/reservas/:id', 'superadmin', { etiquetaId: null }, { id: '1' });
  assert.equal((await call('get', '/reservas', 'superadmin')).data[0].etiqueta, undefined);
  await call('put', '/reservas/:id', 'superadmin', { etiquetaId: etiqueta.id }, { id: '1' });
  await call('delete', '/etiquetas/:id', 'superadmin', {}, { id: etiqueta.id });
  assert.equal((await call('get', '/reservas', 'coordinador')).data[0].etiqueta, undefined);
  assert.equal(JSON.parse(archivos.get('reservas.json'))[0].etiquetaId, undefined);
  assert.equal(JSON.parse(archivos.get('etiquetas.json')).length, 0);
});
