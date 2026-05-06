# Team Task Manager

A full-stack project and task management app with authentication, project teams, task assignment, status tracking, dashboard metrics, and role-based access control.

## Features

- Signup and login with hashed passwords and JWT sessions.
- First registered user becomes an Admin; later users start as Members.
- Admins can create projects, add/remove project members, create tasks, assign users, and manage roles.
- Members can view projects they belong to and update the status of tasks assigned to them.
- Dashboard tracks total tasks, status counts, overdue work, personal open tasks, and project progress.
- REST API with validation, relationships, and access checks.
- PostgreSQL support for Railway production deployment.
- Local JSON-backed development storage when `DATABASE_URL` is not configured.

## Tech Stack

- Node.js
- Express
- PostgreSQL with `pg`
- bcryptjs
- JSON Web Tokens
- Zod validation
- Vanilla HTML, CSS, and JavaScript frontend

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

The app uses `data/dev-db.json` locally if `DATABASE_URL` is empty. For PostgreSQL, set `DATABASE_URL` in `.env`; tables are created automatically when the server starts.

## Default Role Flow

1. Create the first account. It becomes `admin`.
2. Create additional accounts. They become `member`.
3. Login as Admin to create projects, add members, assign tasks, and update roles.

## API Overview

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | Public | Create account |
| `POST` | `/api/auth/login` | Public | Login |
| `GET` | `/api/auth/me` | Authenticated | Current user |
| `GET` | `/api/dashboard` | Authenticated | Dashboard metrics |
| `GET` | `/api/users` | Authenticated | Visible users |
| `PATCH` | `/api/users/:id/role` | Admin | Update user role |
| `GET` | `/api/projects` | Authenticated | Visible projects |
| `POST` | `/api/projects` | Admin | Create project |
| `GET` | `/api/projects/:id` | Project access | Project details and members |
| `PATCH` | `/api/projects/:id` | Admin | Update project |
| `DELETE` | `/api/projects/:id` | Admin | Delete project |
| `POST` | `/api/projects/:id/members` | Admin | Add/update member |
| `DELETE` | `/api/projects/:id/members/:userId` | Admin | Remove member |
| `GET` | `/api/tasks` | Authenticated | Visible tasks |
| `POST` | `/api/tasks` | Admin | Create task |
| `PATCH` | `/api/tasks/:id` | Admin or assigned member | Update task |
| `DELETE` | `/api/tasks/:id` | Admin | Delete task |

## Railway Deployment

1. Push this project to a GitHub repository.
2. In Railway, create a new project from the GitHub repo.
3. Add a PostgreSQL database to the Railway project.
4. Set these service variables:
   - `JWT_SECRET`: a long random value.
   - `DATABASE_URL`: reference the PostgreSQL database variable if Railway does not attach it automatically.
5. Railway can use the included `railway.json`; the start command is `npm start`.
6. Generate a public domain from the service networking settings.
7. Visit the live URL and create the first account.

Railway references:

- PostgreSQL database variables: https://docs.railway.com/guides/postgresql
- Start command behavior: https://docs.railway.com/guides/start-command
- Build and deploy concepts: https://docs.railway.com/build-deploy

## Submission

- Live URL: add after Railway deployment
- GitHub repo: add after pushing to GitHub
- README: this file
