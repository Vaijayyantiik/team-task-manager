const state = {
  token: localStorage.getItem('ttm_token'),
  theme: localStorage.getItem('ttm_theme') || document.documentElement.dataset.theme || 'light',
  authMode: 'login',
  page: 'dashboard',
  user: null,
  users: [],
  projects: [],
  tasks: [],
  dashboard: null,
  selectedProjectId: null,
  membersByProject: {},
  filters: {
    projectId: '',
    status: '',
    assignee: ''
  }
};

const labels = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  admin: 'Admin',
  member: 'Member',
  owner: 'Owner'
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showNotice(message, type = 'info') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = `notice ${type === 'error' ? 'error' : ''}`;
  notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    notice.hidden = true;
  }, 3400);
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && state.token) {
      logout(false);
    }
    throw new Error(body.message || 'Request failed.');
  }

  return body;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === 'signup';
  $('authTitle').textContent = isSignup ? 'Create Account' : 'Login';
  $('authSubmit').textContent = isSignup ? 'Create Account' : 'Login';
  $('switchAuthMode').textContent = isSignup ? 'Use login' : 'Create account';
  $('nameField').hidden = !isSignup;
  $('authName').required = isSignup;
  $('authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
}

function setLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.dataset.originalText ||= button.textContent;
  button.textContent = loading ? 'Working...' : button.dataset.originalText;
}

function applyTheme(theme = state.theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === state.theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setTheme(theme) {
  applyTheme(theme);
  localStorage.setItem('ttm_theme', state.theme);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const button = $('authSubmit');
  setLoading(button, true);

  try {
    const payload = {
      email: $('authEmail').value,
      password: $('authPassword').value
    };

    if (state.authMode === 'signup') {
      payload.name = $('authName').value;
    }

    const endpoint = state.authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const result = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    state.token = result.token;
    state.user = result.user;
    localStorage.setItem('ttm_token', state.token);
    await loadWorkspace();
    showNotice(`Signed in as ${state.user.name}`);
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

function logout(showMessage = true) {
  state.token = null;
  state.user = null;
  state.projects = [];
  state.tasks = [];
  state.users = [];
  state.dashboard = null;
  state.membersByProject = {};
  localStorage.removeItem('ttm_token');
  renderVisibility();
  if (showMessage) showNotice('Logged out.');
}

function isAdmin() {
  return state.user?.role === 'admin';
}

async function loadWorkspace() {
  const me = await api('/api/auth/me');
  state.user = me.user;
  await refreshData();
  renderVisibility();
}

async function refreshData() {
  const [dashboardResult, projectsResult, usersResult, tasksResult] = await Promise.all([
    api('/api/dashboard'),
    api('/api/projects'),
    api('/api/users'),
    api(tasksUrl())
  ]);

  state.dashboard = dashboardResult.dashboard;
  state.projects = projectsResult.projects;
  state.users = usersResult.users;
  state.tasks = tasksResult.tasks;

  if (!state.projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = state.projects[0]?.id || null;
  }

  if (state.selectedProjectId) {
    await loadProjectMembers(state.selectedProjectId, true);
  }

  render();
}

function tasksUrl() {
  const params = new URLSearchParams();
  if (state.filters.projectId) params.set('projectId', state.filters.projectId);
  if (state.filters.status) params.set('status', state.filters.status);
  if (state.filters.assignee) params.set('assignee', state.filters.assignee);
  const query = params.toString();
  return `/api/tasks${query ? `?${query}` : ''}`;
}

async function loadProjectMembers(projectId, force = false) {
  if (!projectId) return [];
  if (!force && state.membersByProject[projectId]) {
    return state.membersByProject[projectId];
  }
  const result = await api(`/api/projects/${projectId}/members`);
  state.membersByProject[projectId] = result.members;
  return result.members;
}

function renderVisibility() {
  $('authView').hidden = Boolean(state.user);
  $('appView').hidden = !state.user;
}

function render() {
  renderVisibility();
  applyTheme();
  if (!state.user) return;

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === state.page);
  });
  document.querySelectorAll('.page').forEach((page) => {
    page.classList.toggle('active', page.id === `${state.page}Page`);
  });
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.hidden = !isAdmin();
  });

  $('userSummary').textContent = `${state.user.name} - ${labels[state.user.role]}`;
  renderDashboard();
  renderProjects();
  renderTasks();
  renderTeam();
}

function renderDashboard() {
  const dashboard = state.dashboard || {
    totalProjects: 0,
    totalTasks: 0,
    statusCounts: { todo: 0, inProgress: 0, done: 0 },
    overdue: 0,
    myOpenTasks: 0,
    completionRate: 0,
    projectProgress: [],
    upcoming: []
  };

  $('dashboardSubhead').textContent = `${dashboard.totalProjects} projects tracked`;

  const metrics = [
    ['Total tasks', dashboard.totalTasks],
    ['To do', dashboard.statusCounts.todo],
    ['In progress', dashboard.statusCounts.inProgress],
    ['Done', dashboard.statusCounts.done, 'success'],
    ['Overdue', dashboard.overdue, 'warning']
  ];

  $('metricGrid').innerHTML = metrics.map(([label, value, tone]) => `
    <article class="metric ${tone || ''}">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join('');

  $('projectProgressList').innerHTML = dashboard.projectProgress.length
    ? dashboard.projectProgress.map((project) => `
        <article class="progress-item">
          <div class="item-head">
            <div class="item-title">${escapeHtml(project.name)}</div>
            <span class="status-pill status-${project.status}">${labels[project.status]}</span>
          </div>
          <div class="progress-track" aria-label="${project.progress}% complete">
            <div class="progress-fill" style="width: ${project.progress}%"></div>
          </div>
          <div class="item-meta">
            <span>${project.completedTasks}/${project.totalTasks} tasks</span>
            <strong>${project.progress}%</strong>
          </div>
        </article>
      `).join('')
    : emptyState('No projects yet.');

  $('upcomingList').innerHTML = dashboard.upcoming.length
    ? dashboard.upcoming.map(renderTaskItem).join('')
    : emptyState('No dated open tasks.');
}

function renderProjects() {
  $('projectCount').textContent = `${state.projects.length} project${state.projects.length === 1 ? '' : 's'}`;

  $('projectList').innerHTML = state.projects.length
    ? state.projects.map((project) => `
        <article class="project-item ${project.id === state.selectedProjectId ? 'selected' : ''}">
          <div class="item-head">
            <div>
              <div class="item-title">${escapeHtml(project.name)}</div>
              <p class="muted">${escapeHtml(project.description || 'No description')}</p>
            </div>
            <span class="status-pill status-${project.status}">${labels[project.status]}</span>
          </div>
          <div class="item-meta">
            <span>${project.memberCount} members</span>
            <span>${project.completedTaskCount}/${project.taskCount} tasks done</span>
            <button class="ghost-button" type="button" data-select-project="${project.id}">Select</button>
          </div>
        </article>
      `).join('')
    : emptyState(isAdmin() ? 'No projects yet.' : 'No projects assigned.');

  $('projectDetailsSelect').innerHTML = state.projects.map((project) => `
    <option value="${project.id}" ${project.id === state.selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>
  `).join('');
  $('projectDetailsSelect').disabled = state.projects.length === 0;

  renderMemberOptions();
  renderProjectMembers();
}

function renderMemberOptions() {
  $('memberUserSelect').innerHTML = state.users.map((user) => `
    <option value="${user.id}">${escapeHtml(user.name)} (${escapeHtml(user.email)})</option>
  `).join('');
}

function renderProjectMembers() {
  const members = state.membersByProject[state.selectedProjectId] || [];
  $('projectMembers').innerHTML = members.length
    ? members.map((member) => `
        <article class="member-item">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <div class="muted">${escapeHtml(member.email)}</div>
          </div>
          <div class="item-meta">
            <span class="role-pill">${labels[member.projectRole]}</span>
            ${isAdmin() ? `<button class="danger-button" type="button" data-remove-member="${member.id}">Remove</button>` : ''}
          </div>
        </article>
      `).join('')
    : emptyState('No members selected.');
}

function renderTasks() {
  $('taskCount').textContent = `${state.tasks.length} visible task${state.tasks.length === 1 ? '' : 's'}`;

  const projectOptions = state.projects.map((project) => `
    <option value="${project.id}">${escapeHtml(project.name)}</option>
  `).join('');

  $('taskProject').innerHTML = projectOptions;
  $('filterProject').innerHTML = `<option value="">All projects</option>${projectOptions}`;
  $('filterProject').value = state.filters.projectId;
  $('filterStatus').value = state.filters.status;
  $('filterAssignee').value = state.filters.assignee;

  renderTaskAssigneeOptions();

  $('taskList').innerHTML = state.tasks.length
    ? state.tasks.map(renderTaskItem).join('')
    : emptyState('No tasks match the current view.');
}

function renderTaskAssigneeOptions() {
  const projectId = $('taskProject').value || state.projects[0]?.id;
  const members = state.membersByProject[projectId] || [];
  $('taskAssignee').innerHTML = `
    <option value="">Unassigned</option>
    ${members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`).join('')}
  `;
}

function renderTaskItem(task) {
  const canChangeStatus = isAdmin() || task.assigneeId === state.user?.id;
  const dueClass = isOverdue(task) ? 'overdue' : '';

  return `
    <article class="task-item">
      <div class="task-head">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <p class="muted">${escapeHtml(task.description || task.projectName)}</p>
        </div>
        <span class="priority-pill priority-${task.priority}">${labels[task.priority]}</span>
      </div>
      <div class="task-foot">
        <span>${escapeHtml(task.projectName)}</span>
        <span>${task.assigneeName ? escapeHtml(task.assigneeName) : 'Unassigned'}</span>
        <span class="${dueClass}">${task.dueDate ? formatDate(task.dueDate) : 'No due date'}</span>
        <select class="task-status-select" data-task-status="${task.id}" ${canChangeStatus ? '' : 'disabled'}>
          ${['todo', 'in_progress', 'done'].map((status) => `
            <option value="${status}" ${task.status === status ? 'selected' : ''}>${labels[status]}</option>
          `).join('')}
        </select>
      </div>
    </article>
  `;
}

function renderTeam() {
  $('teamCount').textContent = `${state.users.length} visible user${state.users.length === 1 ? '' : 's'}`;

  $('teamTable').innerHTML = state.users.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          ${state.users.map((user) => `
            <tr>
              <td><strong>${escapeHtml(user.name)}</strong></td>
              <td>${escapeHtml(user.email)}</td>
              <td>
                ${isAdmin() ? `
                  <select class="role-select" data-user-role="${user.id}" ${user.id === state.user.id ? 'disabled' : ''}>
                    <option value="member" ${user.role === 'member' ? 'selected' : ''}>Member</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                ` : `<span class="role-pill">${labels[user.role]}</span>`}
              </td>
              <td>${formatDate(user.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
    : emptyState('No users yet.');
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'done') return false;
  return task.dueDate < new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '';
  const datePart = String(value).slice(0, 10);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(`${datePart}T00:00:00`));
}

async function handleProjectSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  setLoading(button, true);

  try {
    await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: $('projectName').value,
        description: $('projectDescription').value,
        status: $('projectStatus').value
      })
    });
    event.target.reset();
    showNotice('Project added.');
    await refreshData();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleMemberSubmit(event) {
  event.preventDefault();
  if (!state.selectedProjectId) return;
  const button = event.submitter;
  setLoading(button, true);

  try {
    await api(`/api/projects/${state.selectedProjectId}/members`, {
      method: 'POST',
      body: JSON.stringify({
        userId: $('memberUserSelect').value,
        projectRole: $('memberRoleSelect').value
      })
    });
    showNotice('Member updated.');
    await loadProjectMembers(state.selectedProjectId, true);
    render();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  const button = event.submitter;
  setLoading(button, true);

  try {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        projectId: $('taskProject').value,
        title: $('taskTitle').value,
        description: $('taskDescription').value,
        assigneeId: $('taskAssignee').value,
        dueDate: $('taskDueDate').value,
        priority: $('taskPriority').value,
        status: $('taskStatus').value
      })
    });
    event.target.reset();
    showNotice('Task added.');
    await refreshData();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading(button, false);
  }
}

async function updateTaskStatus(taskId, status) {
  try {
    await api(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await refreshData();
  } catch (error) {
    showNotice(error.message, 'error');
    await refreshData();
  }
}

async function updateUserRole(userId, role) {
  try {
    await api(`/api/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
    showNotice('Role updated.');
    await refreshData();
  } catch (error) {
    showNotice(error.message, 'error');
    await refreshData();
  }
}

function bindEvents() {
  $('authForm').addEventListener('submit', handleAuthSubmit);
  $('switchAuthMode').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'signup' : 'login'));
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });
  $('logoutButton').addEventListener('click', () => logout());
  $('refreshButton').addEventListener('click', async () => {
    try {
      await refreshData();
      showNotice('Workspace refreshed.');
    } catch (error) {
      showNotice(error.message, 'error');
    }
  });

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.page = button.dataset.page;
      render();
    });
  });

  $('projectForm').addEventListener('submit', handleProjectSubmit);
  $('memberForm').addEventListener('submit', handleMemberSubmit);
  $('taskForm').addEventListener('submit', handleTaskSubmit);

  $('projectDetailsSelect').addEventListener('change', async (event) => {
    state.selectedProjectId = event.target.value;
    await loadProjectMembers(state.selectedProjectId, true);
    render();
  });

  $('taskProject').addEventListener('change', async (event) => {
    await loadProjectMembers(event.target.value, true);
    renderTaskAssigneeOptions();
  });

  $('projectList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-select-project]');
    if (!button) return;
    state.selectedProjectId = button.dataset.selectProject;
    await loadProjectMembers(state.selectedProjectId, true);
    render();
  });

  $('projectMembers').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-member]');
    if (!button || !state.selectedProjectId) return;

    try {
      await api(`/api/projects/${state.selectedProjectId}/members/${button.dataset.removeMember}`, {
        method: 'DELETE'
      });
      showNotice('Member removed.');
      await loadProjectMembers(state.selectedProjectId, true);
      await refreshData();
    } catch (error) {
      showNotice(error.message, 'error');
    }
  });

  $('taskList').addEventListener('change', (event) => {
    const select = event.target.closest('[data-task-status]');
    if (select) {
      updateTaskStatus(select.dataset.taskStatus, select.value);
    }
  });

  $('teamTable').addEventListener('change', (event) => {
    const select = event.target.closest('[data-user-role]');
    if (select) {
      updateUserRole(select.dataset.userRole, select.value);
    }
  });

  ['filterProject', 'filterStatus', 'filterAssignee'].forEach((id) => {
    $(id).addEventListener('change', async () => {
      state.filters = {
        projectId: $('filterProject').value,
        status: $('filterStatus').value,
        assignee: $('filterAssignee').value
      };
      try {
        await refreshData();
      } catch (error) {
        showNotice(error.message, 'error');
      }
    });
  });
}

async function boot() {
  applyTheme();
  bindEvents();
  setAuthMode('login');
  renderVisibility();

  if (!state.token) return;

  try {
    await loadWorkspace();
  } catch (error) {
    logout(false);
    showNotice(error.message, 'error');
  }
}

boot();
