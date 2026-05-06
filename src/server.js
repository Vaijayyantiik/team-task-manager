import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createDatabase, DuplicateEmailError } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const roles = ['admin', 'member'];
const projectStatuses = ['active', 'on_hold', 'completed'];
const taskStatuses = ['todo', 'in_progress', 'done'];
const priorities = ['low', 'medium', 'high'];

const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-before-deploy';

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80),
  email: z.string().trim().email('Enter a valid email.').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(120)
});

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email.').max(255),
  password: z.string().min(1, 'Password is required.')
});

const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1500).optional().default(''),
  status: z.enum(projectStatuses).optional().default('active')
});

const projectUpdateSchema = projectCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.'
});

const nullableId = z.preprocess((value) => (value === '' ? null : value), z.string().trim().min(1).nullable().optional());
const nullableDate = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.').nullable().optional()
);

const taskCreateSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(2000).optional().default(''),
  status: z.enum(taskStatuses).optional().default('todo'),
  priority: z.enum(priorities).optional().default('medium'),
  assigneeId: nullableId,
  dueDate: nullableDate
});

const taskUpdateSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(priorities).optional(),
  assigneeId: nullableId,
  dueDate: nullableDate
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.'
});

const memberSchema = z.object({
  userId: z.string().trim().min(1),
  projectRole: z.enum(['owner', 'member']).optional().default('member')
});

const roleSchema = z.object({
  role: z.enum(roles)
});

const taskQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: z.enum(taskStatuses).optional(),
  assignee: z.string().trim().min(1).optional()
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function parseBody(schema, body) {
  return schema.parse(body);
}

export function createApp(db = createDatabase()) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;

  app.use(express.json({ limit: '150kb' }));

  async function authenticate(req, _res, next) {
    try {
      const header = req.get('authorization') || '';
      const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];

      if (!token) {
        throw httpError(401, 'Authentication required.');
      }

      const payload = jwt.verify(token, jwtSecret);
      const user = await db.getUserById(payload.sub);

      if (!user) {
        throw httpError(401, 'Your session is no longer valid.');
      }

      req.user = user;
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        next(httpError(401, 'Your session is no longer valid.'));
        return;
      }
      next(error);
    }
  }

  function requireAdmin(req, _res, next) {
    if (req.user.role !== 'admin') {
      next(httpError(403, 'Admin access required.'));
      return;
    }
    next();
  }

  async function requireProjectAccess(req, projectId) {
    const project = await db.getProjectById(projectId);
    if (!project) {
      throw httpError(404, 'Project not found.');
    }

    if (req.user.role !== 'admin' && !(await db.isProjectMember(projectId, req.user.id))) {
      throw httpError(403, 'You do not have access to this project.');
    }

    return project;
  }

  async function assertAssigneeCanReceiveTask(projectId, assigneeId) {
    if (!assigneeId) return;
    const assignee = await db.getUserById(assigneeId);
    if (!assignee) {
      throw httpError(400, 'Assignee not found.');
    }

    if (!(await db.isProjectMember(projectId, assigneeId))) {
      throw httpError(400, 'Assignee must be a member of the selected project.');
    }
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/auth/signup', asyncHandler(async (req, res) => {
    const input = parseBody(signupSchema, req.body);
    const userCount = await db.countUsers();
    const role = userCount === 0 ? 'admin' : 'member';
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await db.createUser({
      name: input.name,
      email: input.email,
      passwordHash,
      role
    });

    res.status(201).json({
      user: publicUser(user),
      token: signToken(user)
    });
  }));

  app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const user = await db.findUserByEmail(input.email);

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw httpError(401, 'Invalid email or password.');
    }

    res.json({
      user: publicUser(user),
      token: signToken(user)
    });
  }));

  app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.get('/api/users', authenticate, asyncHandler(async (req, res) => {
    const users = await db.listUsersForViewer(req.user);
    res.json({ users });
  }));

  app.patch('/api/users/:id/role', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      throw httpError(400, 'Admins cannot change their own role.');
    }

    const input = parseBody(roleSchema, req.body);
    const user = await db.updateUserRole(req.params.id, input.role);

    if (!user) {
      throw httpError(404, 'User not found.');
    }

    res.json({ user });
  }));

  app.get('/api/projects', authenticate, asyncHandler(async (req, res) => {
    const projects = await db.listProjects(req.user);
    res.json({ projects });
  }));

  app.post('/api/projects', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const input = parseBody(projectCreateSchema, req.body);
    const project = await db.createProject({
      ...input,
      createdBy: req.user.id
    });

    res.status(201).json({ project });
  }));

  app.get('/api/projects/:id', authenticate, asyncHandler(async (req, res) => {
    const project = await requireProjectAccess(req, req.params.id);
    const members = await db.listProjectMembers(project.id);
    res.json({ project, members });
  }));

  app.patch('/api/projects/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const input = parseBody(projectUpdateSchema, req.body);
    const project = await db.updateProject(req.params.id, input);

    if (!project) {
      throw httpError(404, 'Project not found.');
    }

    res.json({ project });
  }));

  app.delete('/api/projects/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const deleted = await db.deleteProject(req.params.id);
    if (!deleted) {
      throw httpError(404, 'Project not found.');
    }
    res.status(204).send();
  }));

  app.get('/api/projects/:id/members', authenticate, asyncHandler(async (req, res) => {
    await requireProjectAccess(req, req.params.id);
    const members = await db.listProjectMembers(req.params.id);
    res.json({ members });
  }));

  app.post('/api/projects/:id/members', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const project = await db.getProjectById(req.params.id);
    if (!project) {
      throw httpError(404, 'Project not found.');
    }

    const input = parseBody(memberSchema, req.body);
    const user = await db.getUserById(input.userId);
    if (!user) {
      throw httpError(404, 'User not found.');
    }

    const members = await db.addProjectMember(project.id, input.userId, input.projectRole);
    res.status(201).json({ members });
  }));

  app.delete('/api/projects/:id/members/:userId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const deleted = await db.removeProjectMember(req.params.id, req.params.userId);
    if (!deleted) {
      throw httpError(404, 'Project member not found.');
    }
    res.status(204).send();
  }));

  app.get('/api/tasks', authenticate, asyncHandler(async (req, res) => {
    const query = taskQuerySchema.parse(req.query);
    const filters = {
      projectId: query.projectId,
      status: query.status,
      assigneeId: query.assignee === 'me' ? req.user.id : query.assignee
    };
    const tasks = await db.listTasks(req.user, filters);
    res.json({ tasks });
  }));

  app.post('/api/tasks', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const input = parseBody(taskCreateSchema, req.body);
    await requireProjectAccess(req, input.projectId);
    await assertAssigneeCanReceiveTask(input.projectId, input.assigneeId);

    const task = await db.createTask({
      ...input,
      createdBy: req.user.id
    });

    res.status(201).json({ task });
  }));

  app.patch('/api/tasks/:id', authenticate, asyncHandler(async (req, res) => {
    const input = parseBody(taskUpdateSchema, req.body);
    const existing = await db.getTaskById(req.params.id);

    if (!existing) {
      throw httpError(404, 'Task not found.');
    }

    if (req.user.role !== 'admin') {
      const keys = Object.keys(input);
      if (existing.assigneeId !== req.user.id || keys.some((key) => key !== 'status')) {
        throw httpError(403, 'Members can update only the status of tasks assigned to them.');
      }
    }

    if (req.user.role === 'admin') {
      await requireProjectAccess(req, existing.projectId);
      if (input.assigneeId !== undefined) {
        await assertAssigneeCanReceiveTask(existing.projectId, input.assigneeId);
      }
    }

    const task = await db.updateTask(existing.id, input);
    res.json({ task });
  }));

  app.delete('/api/tasks/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const deleted = await db.deleteTask(req.params.id);
    if (!deleted) {
      throw httpError(404, 'Task not found.');
    }
    res.status(204).send();
  }));

  app.get('/api/dashboard', authenticate, asyncHandler(async (req, res) => {
    const dashboard = await db.dashboard(req.user);
    res.json({ dashboard });
  }));

  app.use('/api', (_req, _res, next) => {
    next(httpError(404, 'API route not found.'));
  });

  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        message: 'Validation failed.',
        details: error.flatten()
      });
      return;
    }

    if (error instanceof DuplicateEmailError) {
      res.status(409).json({ message: error.message });
      return;
    }

    const status = error.status || 500;
    const message = status === 500 ? 'Something went wrong.' : error.message;
    if (status === 500) {
      console.error(error);
    }
    res.status(status).json({ message });
  });

  return app;
}

export async function startServer() {
  const db = createDatabase();
  await db.init();
  const app = createApp(db);
  const port = Number(process.env.PORT || 3000);

  return app.listen(port, () => {
    console.log(`Team Task Manager running on http://localhost:${port}`);
    console.log(process.env.DATABASE_URL ? 'Database: PostgreSQL' : 'Database: local JSON store');
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
