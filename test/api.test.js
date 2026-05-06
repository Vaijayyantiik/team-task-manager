import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/db/index.js';

const testDbPath = path.join(process.cwd(), 'data', `test-db-${Date.now()}.json`);

let db;
let server;
let baseUrl;

async function request(pathname, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

before(async () => {
  delete process.env.DATABASE_URL;
  process.env.DATA_FILE = testDbPath;
  process.env.JWT_SECRET = 'test-secret';

  db = createDatabase();
  await db.init();
  const app = createApp(db);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  await fs.rm(testDbPath, { force: true }).catch(() => {});
});

test('supports admin/member project and task workflow', async () => {
  const adminSignup = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Avery Admin',
      email: 'admin@example.com',
      password: 'password123'
    })
  });
  assert.equal(adminSignup.response.status, 201);
  assert.equal(adminSignup.body.user.role, 'admin');

  const memberSignup = await request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Mina Member',
      email: 'member@example.com',
      password: 'password123'
    })
  });
  assert.equal(memberSignup.response.status, 201);
  assert.equal(memberSignup.body.user.role, 'member');

  const adminToken = adminSignup.body.token;
  const memberToken = memberSignup.body.token;
  const memberId = memberSignup.body.user.id;

  const projectResult = await request('/api/projects', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      name: 'Launch Plan',
      description: 'Release coordination',
      status: 'active'
    })
  });
  assert.equal(projectResult.response.status, 201);
  const projectId = projectResult.body.project.id;

  const addMember = await request(`/api/projects/${projectId}/members`, {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      userId: memberId,
      projectRole: 'member'
    })
  });
  assert.equal(addMember.response.status, 201);
  assert.equal(addMember.body.members.some((member) => member.id === memberId), true);

  const taskResult = await request('/api/tasks', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      projectId,
      title: 'Prepare status deck',
      description: 'Summarize active risks',
      priority: 'high',
      assigneeId: memberId,
      dueDate: '2026-05-10'
    })
  });
  assert.equal(taskResult.response.status, 201);
  assert.equal(taskResult.body.task.assigneeId, memberId);

  const forbiddenEdit = await request(`/api/tasks/${taskResult.body.task.id}`, {
    token: memberToken,
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Rename task'
    })
  });
  assert.equal(forbiddenEdit.response.status, 403);

  const statusUpdate = await request(`/api/tasks/${taskResult.body.task.id}`, {
    token: memberToken,
    method: 'PATCH',
    body: JSON.stringify({
      status: 'in_progress'
    })
  });
  assert.equal(statusUpdate.response.status, 200);
  assert.equal(statusUpdate.body.task.status, 'in_progress');

  const dashboard = await request('/api/dashboard', { token: memberToken });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.totalProjects, 1);
  assert.equal(dashboard.body.dashboard.myOpenTasks, 1);
});
