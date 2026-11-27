const test = require('node:test');
const assert = require('node:assert/strict');
const assignmentRoutes = require('./assignments');
const studentPortalRoutes = require('./studentPortal');
const parentPortalRoutes = require('./parentPortal');
const learningMaterialsRoutes = require('./learningMaterials');

const routeBy = (router, method, routePath) => router.stack.find((layer) => layer.route
  && layer.route.path === routePath && layer.route.methods[method]);
const rolesOn = (routeLayer) => routeLayer.route.stack
  .map((layer) => layer.handle.allowedRoles)
  .find(Boolean);

test('assignment management and marking routes are restricted to school admins and teachers', () => {
  for (const [method, path] of [
    ['get','/meta'], ['get','/'], ['post','/'], ['put','/:id'], ['post','/:id/publish'],
    ['get','/:id/submissions'], ['put','/:id/submissions/:submissionId/mark'],
    ['post','/:id/attachments'],
  ]) {
    const route = routeBy(assignmentRoutes, method, path);
    assert.ok(route, `${method.toUpperCase()} ${path} is registered`);
    assert.deepEqual(rolesOn(route), ['admin', 'teacher'], `${method.toUpperCase()} ${path}`);
  }
});

test('file downloads allow student routes but no student mutation route is exposed', () => {
  for (const path of ['/:id/attachments/:fileId', '/:id/submission-files/:fileId']) {
    assert.deepEqual(rolesOn(routeBy(assignmentRoutes, 'get', path)), ['admin', 'teacher', 'student']);
  }
  for (const route of assignmentRoutes.stack.filter((layer) => layer.route)) {
    assert.equal(route.route.methods.delete, undefined);
  }
  const studentGuard = studentPortalRoutes.stack.map((layer) => layer.handle.allowedRoles).find(Boolean);
  assert.deepEqual(studentGuard, ['student']);
});

test('parent assignment access remains nested under active parent authorization', () => {
  const parentRouterLayer = parentPortalRoutes.stack.find((layer) => !layer.route && layer.handle?.stack
    && layer.handle.stack.some((child) => child.route?.path === '/children/:studentId/assignments'));
  assert.ok(parentRouterLayer, 'parent portal subrouter is mounted');
  const childRouter = parentRouterLayer.handle;
  const assignmentRoute = routeBy(childRouter, 'get', '/children/:studentId/assignments');
  assert.ok(assignmentRoute);
  assert.ok(childRouter.stack.some((layer) => layer.handle.allowedRoles?.includes('parent')));
  assert.ok(childRouter.stack.some((layer) => layer.handle.name === 'requireActiveParent'));
  assert.equal(assignmentRoute.route.methods.post, undefined);
  assert.equal(assignmentRoute.route.methods.put, undefined);
  assert.equal(assignmentRoute.route.methods.delete, undefined);
});

test('Learning Materials management is staff-only and student access is read-only', () => {
  for (const [method,path] of [['get','/meta'],['get','/'],['post','/'],['get','/:id/files/:fileId']]) {
    assert.deepEqual(rolesOn(routeBy(learningMaterialsRoutes,method,path)),['admin','teacher']);
  }
  const studentMaterialRoutes=studentPortalRoutes.stack.filter((layer)=>layer.route && layer.route.path.startsWith('/materials'));
  assert.deepEqual(studentMaterialRoutes.map((layer)=>Object.keys(layer.route.methods)),[['get'],['get']]);
  assert.equal(studentMaterialRoutes.some((layer)=>layer.route.methods.post||layer.route.methods.put||layer.route.methods.delete),false);
});
