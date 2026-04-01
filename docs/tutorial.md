# Tutorial: Build your first app with OzyBase

In this tutorial, we will build a simple **Task Manager** using React and the current OzyBase HTTP client pattern. The public npm SDK package is still pending, so the supported path today is direct HTTP plus generated types.

## 1. Setup the backend

Ensure OzyBase is running. If you do not have an external DB configured, it will start with embedded Postgres automatically.

```bash
# Start OzyBase
go run ./cmd/ozybase

# In another terminal, create the collection
curl -X POST http://localhost:8090/api/collections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tasks",
    "schema": [
      {"name": "title", "type": "text", "required": true},
      {"name": "is_completed", "type": "boolean", "default": false}
    ],
    "list_rule": "public",
    "create_rule": "public"
  }'
```

## 2. Generate types

Generate TypeScript interfaces for your new collection:

```bash
go run ./cmd/ozybase gen-types --out ./src/types/OzyBase.ts
```

## 3. Use the current client pattern

Until the npm SDK is published, use a small HTTP wrapper in your app:

```tsx
import React, { useEffect, useState } from 'react';

type Task = {
  id: string;
  title: string;
  is_completed: boolean;
};

const API_URL = 'http://localhost:8090';

async function listTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/api/tables/tasks`);
  if (!res.ok) {
    throw new Error('Failed to load tasks');
  }

  const data = await res.json();
  if (Array.isArray(data)) {
    return data as Task[];
  }

  if (Array.isArray(data?.data)) {
    return data.data as Task[];
  }

  return [];
}

async function createTask(input: Pick<Task, 'title' | 'is_completed'>) {
  const res = await fetch(`${API_URL}/api/tables/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error('Failed to create task');
  }
}

export const TaskApp = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listTasks()
      .then(setTasks)
      .finally(() => setLoading(false));
  }, []);

  const addTask = async () => {
    await createTask({
      title: 'Learn OzyBase',
      is_completed: false,
    });

    setTasks(await listTasks());
  };

  if (loading) {
    return <p>Loading tasks...</p>;
  }

  return (
    <div>
      <h1>Tasks</h1>
      <button onClick={addTask}>Add Task</button>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  );
};
```

## 4. Summary

You now have a working React integration against the current OzyBase runtime.

- **Zero Config**: No manual local database setup is required.
- **Type Safety**: `gen-types` can generate interfaces for your tables.
- **Simple Client Path**: Direct HTTP access works today without waiting for the npm package release.
- **Upgrade Path**: When the public SDK package ships, this tutorial can be swapped to the package-based client.

---

**SDK publication status:** the public npm package is still pending. Track SDK work in the repo linked from the project status docs before promising `npm install`.
