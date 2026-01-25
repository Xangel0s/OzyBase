# Tutorial: Build your first App with OzyBase 🚀

In this tutorial, we will build a simple **Realtime Task Manager** using React, OzyBase SDK, and TypeScript.

## 1. Setup the Backend

First, ensure OzyBase is running and create a `tasks` collection:

```bash
# Register an admin user (if you haven't)
curl -X POST http://localhost:8090/api/auth/signup \
  -d '{"email":"admin@example.com", "password":"StrongPassword123!"}'

# Login to get token
# (Save the token from response)

# Create the collection
curl -X POST http://localhost:8090/api/collections \
  -H "Authorization: Bearer YOUR_TOKEN" \
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

## 2. Generate Types

Generate the TypeScript interfaces for your new collection:

```bash
go run ./cmd/OzyBase gen-types --out ./src/types/OzyBase.ts
```

## 3. Install the SDK

In your React project:

```bash
npm install @OzyBase/sdk
```

## 4. Connect with React

```tsx
import React, { useEffect, useState } from 'react';
import { createClient } from '@OzyBase/sdk';
import { Database } from './types/OzyBase';

// Initialize client with generated types
const OzyBase = createClient<Database>('http://localhost:8090');

export const TaskApp = () => {
  const [tasks, setTasks] = useState<Database['public']['Tables']['tasks']['Row'][]>([]);

  useEffect(() => {
    // 1. Fetch initial tasks
    const fetchTasks = async () => {
      const { data } = await OzyBase.from('tasks').select('*');
      if (data) setTasks(data);
    };

    fetchTasks();

    // 2. Subscribe to REALTIME updates
    const channel = OzyBase
      .channel('tasks')
      .on('INSERT', (payload) => {
        setTasks((prev) => [...prev, payload.new as any]);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const addTask = async () => {
    await OzyBase.from('tasks').insert({
      title: 'Learn OzyBase',
      is_completed: false
    });
  };

  return (
    <div>
      <h1>Tasks</h1>
      <button onClick={addTask}>Add Task</button>
      <ul>
        {tasks.map(task => (
          <li key={task.id}>{task.title}</li>
        ))}
      </ul>
    </div>
  );
};
```

## 5. Summary

You've just built a scalable, type-safe, and realtime application using **OzyBase**.

*   **Type Safety**: Your IDE now knows exactly what fields `tasks` has.
*   **Realtime**: When another user adds a task, it appears instantly.
*   **Performance**: The backend is consuming less than 30MB of RAM.

---

**Ready for more?** Check the [SDK Documentation](../sdk/js/README.md).

