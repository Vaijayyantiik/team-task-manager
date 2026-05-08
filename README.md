# 🚀 Team Task Manager

A full-stack **Project & Task Management Web Application** with authentication, role-based access control, project collaboration, and real-time task tracking.

---

## 🌐 Live Demo

* 🔗 Live URL: https://team-task-manager-production-3a3e.up.railway.app
* 📂 GitHub Repo: https://github.com/Vaijayyantiik/team-task-manager

---

## 📌 Overview

Team Task Manager allows teams to:

* Create and manage projects
* Assign tasks to members
* Track progress with dashboards
* Enforce secure role-based access

---

## ✨ Features

### 🔐 Authentication & Security

* User Signup & Login
* Password hashing using bcrypt
* JWT-based authentication
* Secure API access

---

### 👥 Role-Based Access Control

* First registered user → **Admin**
* Other users → **Members**
* Admin permissions:

  * Create/Delete projects
  * Add/remove members
  * Assign tasks
  * Manage user roles
* Member permissions:

  * View assigned projects
  * Update task status

---

### 📁 Project Management

* Create, update, delete projects
* Add/remove team members
* View project details

---

### 📌 Task Management

* Create and assign tasks
* Track task status:

  * Todo
  * In Progress
  * Done
* Set deadlines
* Update task progress

---

### 📊 Dashboard

* Total tasks
* Completed tasks
* Pending tasks
* Overdue tasks
* Personal assigned tasks
* Project-wise progress

---

### ⚙️ Backend Features

* RESTful API architecture
* Input validation using Zod
* Proper data relationships
* Access control middleware

---

### 🗄️ Database Support

* PostgreSQL (Production - Railway)
* JSON-based local storage (Development fallback)

---

## 🛠️ Tech Stack

| Layer          | Technology            |
| -------------- | --------------------- |
| Frontend       | HTML, CSS, JavaScript |
| Backend        | Node.js, Express      |
| Database       | PostgreSQL (`pg`)     |
| Authentication | JWT, bcryptjs         |
| Validation     | Zod                   |
| Deployment     | Railway               |

---

## 📂 Project Structure

```
team-task-manager/
│
├── src/            # Backend logic
├── public/         # Frontend files
├── data/           # Local JSON database
├── test/           # API tests
├── .env.example
├── package.json
├── railway.json
└── README.md
```

---

## ⚙️ Local Setup

### 1️⃣ Clone Repository

```
git clone https://github.com/Vaijayyantiik/team-task-manager.git
cd team-task-manager
```

### 2️⃣ Install Dependencies

```
npm install
```

### 3️⃣ Setup Environment

```
cp .env.example .env
```

### 4️⃣ Run Application

```
npm run dev
```

👉 Open: http://localhost:3000

---

## 🧠 Default Role Flow

1. First registered user → **Admin**
2. Next users → **Members**
3. Admin manages:

   * Projects
   * Members
   * Tasks

---

## 🔗 API Overview

| Method | Endpoint                            | Access       | Description       |
| ------ | ----------------------------------- | ------------ | ----------------- |
| POST   | `/api/auth/signup`                  | Public       | Register user     |
| POST   | `/api/auth/login`                   | Public       | Login             |
| GET    | `/api/auth/me`                      | Auth         | Current user      |
| GET    | `/api/dashboard`                    | Auth         | Dashboard metrics |
| GET    | `/api/users`                        | Auth         | Get users         |
| PATCH  | `/api/users/:id/role`               | Admin        | Update role       |
| GET    | `/api/projects`                     | Auth         | Get projects      |
| POST   | `/api/projects`                     | Admin        | Create project    |
| GET    | `/api/projects/:id`                 | Access       | Project details   |
| PATCH  | `/api/projects/:id`                 | Admin        | Update project    |
| DELETE | `/api/projects/:id`                 | Admin        | Delete project    |
| POST   | `/api/projects/:id/members`         | Admin        | Add member        |
| DELETE | `/api/projects/:id/members/:userId` | Admin        | Remove member     |
| GET    | `/api/tasks`                        | Auth         | Get tasks         |
| POST   | `/api/tasks`                        | Admin        | Create task       |
| PATCH  | `/api/tasks/:id`                    | Admin/Member | Update task       |
| DELETE | `/api/tasks/:id`                    | Admin        | Delete task       |

---

## 🚀 Deployment (Railway)

1. Push code to GitHub
2. Open Railway → New Project
3. Deploy from GitHub repo
4. Add PostgreSQL database
5. Set environment variables:

```
JWT_SECRET=your_secret_key
DATABASE_URL=your_database_url
```

6. Deploy and generate public domain

---

## 📸 Screenshots *(Optional but Recommended)*

* Login Page
* Dashboard
* Project Page
* Task Management

---

## 📦 Submission

* 🌐 Live URL: https://team-task-manager-production-3a3e.up.railway.app
* 📂 GitHub Repo: https://github.com/Vaijayyantiik/team-task-manager


---

## 💡 Future Improvements

* Drag & Drop Kanban Board
* Email Notifications
* Dark Mode UI
* Advanced Filters & Search

---

## 👩‍💻 Author

**Vaijayanti Kulkarni**

* GitHub: https://github.com/Vaijayyantiik

---

