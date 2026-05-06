import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this email already exists.');
    this.name = 'DuplicateEmailError';
  }
}

const statusOrder = {
  todo: 0,
  in_progress: 1,
  done: 2
};

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

function userFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: toIso(row.created_at)
  };
}

function publicUserFromStored(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    memberCount: Number(row.member_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    completedTaskCount: Number(row.completed_task_count ?? 0)
  };
}

function memberFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    projectRole: row.project_role,
    addedAt: toIso(row.added_at)
  };
}

function taskFromRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    dueDate: normalizeDate(row.due_date),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function createDatabase() {
  if (process.env.DATABASE_URL) {
    return new PostgresStore(process.env.DATABASE_URL);
  }

  const filePath = process.env.DATA_FILE || path.join(process.cwd(), 'data', 'dev-db.json');
  return new JsonStore(filePath);
}

export function buildDashboard(projects, tasks, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const totalTasks = tasks.length;
  const todo = tasks.filter((task) => task.status === 'todo').length;
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
  const done = tasks.filter((task) => task.status === 'done').length;
  const overdue = tasks.filter((task) => task.status !== 'done' && task.dueDate && task.dueDate < today).length;
  const myOpenTasks = tasks.filter((task) => task.assigneeId === userId && task.status !== 'done').length;

  const projectProgress = projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const completed = projectTasks.filter((task) => task.status === 'done').length;
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      totalTasks: projectTasks.length,
      completedTasks: completed,
      progress: projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0
    };
  });

  const upcoming = tasks
    .filter((task) => task.status !== 'done' && task.dueDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || statusOrder[a.status] - statusOrder[b.status])
    .slice(0, 6);

  return {
    totalProjects: projects.length,
    totalTasks,
    statusCounts: {
      todo,
      inProgress,
      done
    },
    overdue,
    myOpenTasks,
    completionRate: totalTasks ? Math.round((done / totalTasks) * 100) : 0,
    projectProgress,
    upcoming
  };
}

class PostgresStore {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
    });
  }

  async init() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    await this.pool.query(schema);
  }

  async close() {
    await this.pool.end();
  }

  async countUsers() {
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM users');
    return result.rows[0].count;
  }

  async createUser({ name, email, passwordHash, role }) {
    try {
      const result = await this.pool.query(
        `INSERT INTO users (id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [randomUUID(), name, normalizeEmail(email), passwordHash, role]
      );
      return userFromRow(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        throw new DuplicateEmailError();
      }
      throw error;
    }
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async getUserById(id) {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async listUsersForViewer(viewer) {
    if (viewer.role === 'admin') {
      const result = await this.pool.query('SELECT * FROM users ORDER BY name ASC');
      return result.rows.map(userFromRow).map(publicUserFromStored);
    }

    const result = await this.pool.query(
      `SELECT DISTINCT u.*
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id IN (
         SELECT project_id FROM project_members WHERE user_id = $1
       )
       ORDER BY u.name ASC`,
      [viewer.id]
    );
    return result.rows.map(userFromRow).map(publicUserFromStored);
  }

  async updateUserRole(id, role) {
    const result = await this.pool.query(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING *',
      [id, role]
    );
    return result.rows[0] ? publicUserFromStored(userFromRow(result.rows[0])) : null;
  }

  projectSelectSql() {
    return `
      SELECT p.*,
        (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS completed_task_count
      FROM projects p
    `;
  }

  async listProjects(viewer) {
    const result = await this.pool.query(
      `${this.projectSelectSql()}
       WHERE $1::boolean = true
          OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $2
          )
       ORDER BY p.created_at DESC`,
      [viewer.role === 'admin', viewer.id]
    );
    return result.rows.map(projectFromRow);
  }

  async getProjectById(id) {
    const result = await this.pool.query(`${this.projectSelectSql()} WHERE p.id = $1`, [id]);
    return result.rows[0] ? projectFromRow(result.rows[0]) : null;
  }

  async createProject({ name, description, status, createdBy }) {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO projects (id, name, description, status, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, name, description ?? '', status ?? 'active', createdBy]
      );
      await client.query(
        `INSERT INTO project_members (project_id, user_id, project_role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [id, createdBy]
      );
      await client.query('COMMIT');
      return projectFromRow({ ...result.rows[0], member_count: 1, task_count: 0, completed_task_count: 0 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateProject(id, fields) {
    const allowed = {
      name: 'name',
      description: 'description',
      status: 'status'
    };
    const updates = [];
    const values = [id];

    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && allowed[key]) {
        values.push(value);
        updates.push(`${allowed[key]} = $${values.length}`);
      }
    });

    if (!updates.length) return this.getProjectById(id);

    const result = await this.pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $1 RETURNING id`,
      values
    );
    return result.rows[0] ? this.getProjectById(id) : null;
  }

  async deleteProject(id) {
    const result = await this.pool.query('DELETE FROM projects WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async isProjectMember(projectId, userId) {
    const result = await this.pool.query(
      'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId]
    );
    return result.rowCount > 0;
  }

  async listProjectMembers(projectId) {
    const result = await this.pool.query(
      `SELECT u.id, u.name, u.email, u.role, pm.project_role, pm.added_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.project_role DESC, u.name ASC`,
      [projectId]
    );
    return result.rows.map(memberFromRow);
  }

  async addProjectMember(projectId, userId, projectRole = 'member') {
    await this.pool.query(
      `INSERT INTO project_members (project_id, user_id, project_role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET project_role = EXCLUDED.project_role`,
      [projectId, userId, projectRole]
    );
    return this.listProjectMembers(projectId);
  }

  async removeProjectMember(projectId, userId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );
      if (result.rowCount > 0) {
        await client.query(
          `UPDATE tasks
           SET assignee_id = NULL, updated_at = NOW()
           WHERE project_id = $1 AND assignee_id = $2`,
          [projectId, userId]
        );
      }
      await client.query('COMMIT');
      return result.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  taskSelectSql() {
    return `
      SELECT t.*, p.name AS project_name, assignee.name AS assignee_name, creator.name AS created_by_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users assignee ON assignee.id = t.assignee_id
      LEFT JOIN users creator ON creator.id = t.created_by
    `;
  }

  async listTasks(viewer, filters = {}) {
    const params = [viewer.role === 'admin', viewer.id];
    const where = [
      `($1::boolean = true OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = t.project_id AND pm.user_id = $2
      ))`
    ];

    if (filters.projectId) {
      params.push(filters.projectId);
      where.push(`t.project_id = $${params.length}`);
    }

    if (filters.status) {
      params.push(filters.status);
      where.push(`t.status = $${params.length}`);
    }

    if (filters.assigneeId) {
      params.push(filters.assigneeId);
      where.push(`t.assignee_id = $${params.length}`);
    }

    const result = await this.pool.query(
      `${this.taskSelectSql()}
       WHERE ${where.join(' AND ')}
       ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`,
      params
    );
    return result.rows.map(taskFromRow);
  }

  async getTaskById(id) {
    const result = await this.pool.query(`${this.taskSelectSql()} WHERE t.id = $1`, [id]);
    return result.rows[0] ? taskFromRow(result.rows[0]) : null;
  }

  async createTask({ projectId, title, description, status, priority, assigneeId, dueDate, createdBy }) {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        projectId,
        title,
        description ?? '',
        status ?? 'todo',
        priority ?? 'medium',
        assigneeId || null,
        normalizeDate(dueDate),
        createdBy
      ]
    );
    return this.getTaskById(id);
  }

  async updateTask(id, fields) {
    const allowed = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      assigneeId: 'assignee_id',
      dueDate: 'due_date'
    };
    const updates = [];
    const values = [id];

    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && allowed[key]) {
        values.push(key === 'dueDate' ? normalizeDate(value) : value);
        updates.push(`${allowed[key]} = $${values.length}`);
      }
    });

    if (!updates.length) return this.getTaskById(id);
    updates.push('updated_at = NOW()');

    const result = await this.pool.query(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $1 RETURNING id`,
      values
    );
    return result.rows[0] ? this.getTaskById(id) : null;
  }

  async deleteTask(id) {
    const result = await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  async dashboard(viewer) {
    const [projects, tasks] = await Promise.all([
      this.listProjects(viewer),
      this.listTasks(viewer)
    ]);
    return buildDashboard(projects, tasks, viewer.id);
  }
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = {
        users: [],
        projects: [],
        projectMembers: [],
        tasks: []
      };
      await this.persist();
    }
  }

  async close() {}

  async persist() {
    await fs.writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
  }

  async countUsers() {
    return this.data.users.length;
  }

  async createUser({ name, email, passwordHash, role }) {
    const normalizedEmail = normalizeEmail(email);
    if (this.data.users.some((user) => user.email === normalizedEmail)) {
      throw new DuplicateEmailError();
    }

    const user = {
      id: randomUUID(),
      name,
      email: normalizedEmail,
      passwordHash,
      role,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(user);
    await this.persist();
    return user;
  }

  async findUserByEmail(email) {
    return this.data.users.find((user) => user.email === normalizeEmail(email)) || null;
  }

  async getUserById(id) {
    return this.data.users.find((user) => user.id === id) || null;
  }

  async listUsersForViewer(viewer) {
    if (viewer.role === 'admin') {
      return this.data.users
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(publicUserFromStored);
    }

    const projectIds = this.data.projectMembers
      .filter((member) => member.userId === viewer.id)
      .map((member) => member.projectId);
    const visibleUserIds = new Set(
      this.data.projectMembers
        .filter((member) => projectIds.includes(member.projectId))
        .map((member) => member.userId)
    );

    return this.data.users
      .filter((user) => visibleUserIds.has(user.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(publicUserFromStored);
  }

  async updateUserRole(id, role) {
    const user = this.data.users.find((candidate) => candidate.id === id);
    if (!user) return null;
    user.role = role;
    await this.persist();
    return publicUserFromStored(user);
  }

  enrichProject(project) {
    const memberCount = this.data.projectMembers.filter((member) => member.projectId === project.id).length;
    const projectTasks = this.data.tasks.filter((task) => task.projectId === project.id);
    return {
      ...project,
      memberCount,
      taskCount: projectTasks.length,
      completedTaskCount: projectTasks.filter((task) => task.status === 'done').length
    };
  }

  async listProjects(viewer) {
    const visibleProjectIds = new Set(
      this.data.projectMembers
        .filter((member) => member.userId === viewer.id)
        .map((member) => member.projectId)
    );

    return this.data.projects
      .filter((project) => viewer.role === 'admin' || visibleProjectIds.has(project.id))
      .map((project) => this.enrichProject(project))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getProjectById(id) {
    const project = this.data.projects.find((candidate) => candidate.id === id);
    return project ? this.enrichProject(project) : null;
  }

  async createProject({ name, description, status, createdBy }) {
    const project = {
      id: randomUUID(),
      name,
      description: description ?? '',
      status: status ?? 'active',
      createdBy,
      createdAt: new Date().toISOString()
    };
    this.data.projects.push(project);
    this.data.projectMembers.push({
      projectId: project.id,
      userId: createdBy,
      projectRole: 'owner',
      addedAt: new Date().toISOString()
    });
    await this.persist();
    return this.enrichProject(project);
  }

  async updateProject(id, fields) {
    const project = this.data.projects.find((candidate) => candidate.id === id);
    if (!project) return null;
    ['name', 'description', 'status'].forEach((key) => {
      if (fields[key] !== undefined) project[key] = fields[key];
    });
    await this.persist();
    return this.enrichProject(project);
  }

  async deleteProject(id) {
    const before = this.data.projects.length;
    this.data.projects = this.data.projects.filter((project) => project.id !== id);
    this.data.projectMembers = this.data.projectMembers.filter((member) => member.projectId !== id);
    this.data.tasks = this.data.tasks.filter((task) => task.projectId !== id);
    await this.persist();
    return this.data.projects.length !== before;
  }

  async isProjectMember(projectId, userId) {
    return this.data.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
  }

  async listProjectMembers(projectId) {
    return this.data.projectMembers
      .filter((member) => member.projectId === projectId)
      .map((member) => {
        const user = this.data.users.find((candidate) => candidate.id === member.userId);
        if (!user) return null;
        return {
          ...publicUserFromStored(user),
          projectRole: member.projectRole,
          addedAt: member.addedAt
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.projectRole.localeCompare(a.projectRole) || a.name.localeCompare(b.name));
  }

  async addProjectMember(projectId, userId, projectRole = 'member') {
    const project = this.data.projects.find((candidate) => candidate.id === projectId);
    const user = this.data.users.find((candidate) => candidate.id === userId);
    if (!project || !user) return null;

    const existing = this.data.projectMembers.find((member) => member.projectId === projectId && member.userId === userId);
    if (existing) {
      existing.projectRole = projectRole;
    } else {
      this.data.projectMembers.push({
        projectId,
        userId,
        projectRole,
        addedAt: new Date().toISOString()
      });
    }

    await this.persist();
    return this.listProjectMembers(projectId);
  }

  async removeProjectMember(projectId, userId) {
    const before = this.data.projectMembers.length;
    this.data.projectMembers = this.data.projectMembers.filter(
      (member) => !(member.projectId === projectId && member.userId === userId)
    );
    if (before !== this.data.projectMembers.length) {
      this.data.tasks
        .filter((task) => task.projectId === projectId && task.assigneeId === userId)
        .forEach((task) => {
          task.assigneeId = null;
          task.updatedAt = new Date().toISOString();
        });
    }
    await this.persist();
    return before !== this.data.projectMembers.length;
  }

  enrichTask(task) {
    const project = this.data.projects.find((candidate) => candidate.id === task.projectId);
    const assignee = this.data.users.find((candidate) => candidate.id === task.assigneeId);
    const creator = this.data.users.find((candidate) => candidate.id === task.createdBy);
    return {
      ...task,
      projectName: project?.name || 'Deleted project',
      assigneeName: assignee?.name || null,
      createdByName: creator?.name || null
    };
  }

  async listTasks(viewer, filters = {}) {
    const visibleProjectIds = new Set(
      this.data.projectMembers
        .filter((member) => member.userId === viewer.id)
        .map((member) => member.projectId)
    );

    return this.data.tasks
      .filter((task) => viewer.role === 'admin' || visibleProjectIds.has(task.projectId))
      .filter((task) => !filters.projectId || task.projectId === filters.projectId)
      .filter((task) => !filters.status || task.status === filters.status)
      .filter((task) => !filters.assigneeId || task.assigneeId === filters.assigneeId)
      .map((task) => this.enrichTask(task))
      .sort((a, b) => {
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  async getTaskById(id) {
    const task = this.data.tasks.find((candidate) => candidate.id === id);
    return task ? this.enrichTask(task) : null;
  }

  async createTask({ projectId, title, description, status, priority, assigneeId, dueDate, createdBy }) {
    const task = {
      id: randomUUID(),
      projectId,
      title,
      description: description ?? '',
      status: status ?? 'todo',
      priority: priority ?? 'medium',
      assigneeId: assigneeId || null,
      dueDate: normalizeDate(dueDate),
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.tasks.push(task);
    await this.persist();
    return this.enrichTask(task);
  }

  async updateTask(id, fields) {
    const task = this.data.tasks.find((candidate) => candidate.id === id);
    if (!task) return null;
    ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate'].forEach((key) => {
      if (fields[key] !== undefined) {
        task[key] = key === 'dueDate' ? normalizeDate(fields[key]) : fields[key];
      }
    });
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return this.enrichTask(task);
  }

  async deleteTask(id) {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((task) => task.id !== id);
    await this.persist();
    return before !== this.data.tasks.length;
  }

  async dashboard(viewer) {
    const [projects, tasks] = await Promise.all([
      this.listProjects(viewer),
      this.listTasks(viewer)
    ]);
    return buildDashboard(projects, tasks, viewer.id);
  }
}
