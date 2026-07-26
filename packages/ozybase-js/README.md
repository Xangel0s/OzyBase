# OzyBase Client SDK (JavaScript & TypeScript)

Official zero-dependency client SDK for **OzyBase Core** — the ultra-lightweight Go/PostgreSQL backend engine.

[![npm version](https://img.shields.io/npm/v/@ozybase/js.svg)](https://www.npmjs.com/package/@ozybase/js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 📦 Installation

```bash
npm install @ozybase/js
# or
yarn add @ozybase/js
# or
pnpm add @ozybase/js
```

---

## ⚡ Quickstart

### 1. Initialize Client

```typescript
import { createClient } from '@ozybase/js';

// Connect to your self-hosted OzyBase instance
const ozy = createClient('http://localhost:8090');
```

---

### 2. Authentication

```typescript
// Login Admin / User
const { session, error } = await ozy.auth.login('user@example.com', 'secretpassword');

if (error) {
  console.error('Login failed:', error);
} else {
  console.log('Logged in as:', session.user.email);
}

// Logout
ozy.auth.logout();
```

---

### 3. Database Queries

```typescript
// Select records with filtering & sorting
const { data: posts, error } = await ozy.from('posts')
  .filter('status', 'eq', 'published')
  .order('created_at', 'desc')
  .limit(10)
  .select();

// Insert a new record
const { data: newPost, error: createErr } = await ozy.from('posts').insert({
  title: 'My First Post',
  content: 'Hello OzyBase!',
  status: 'published'
});

// Update a record
const { data: updated, error: updateErr } = await ozy.from('posts').update(123, {
  title: 'Updated Title'
});

// Delete a record
const { success, error: deleteErr } = await ozy.from('posts').delete(123);
```

---

### 4. Storage (File Uploads)

```typescript
const fileInput = document.getElementById('myFile') as HTMLInputElement;
const file = fileInput.files[0];

// Upload to bucket 'avatars'
const { url, error } = await ozy.storage('avatars').upload(file, 'user_123.png');

// Get public URL
const publicUrl = ozy.storage('avatars').getPublicUrl('user_123.png');
```

---

## 🛠️ TypeScript Support

OzyBase core provides an automatic TypeScript generator directly from your live database schema.

You can download your project's types directly from the OzyBase Dashboard (**Schema Visualizer > TS Types**) or via the API:

```bash
curl http://localhost:8090/api/project/schema/types > ozybase_types.ts
```

Then type your queries in code:

```typescript
import { Posts } from './ozybase_types';

const { data } = await ozy.from<Posts>('posts').select();
// data will be typed as Posts[]
```

---

## 📄 License

MIT © [OzyBase Team](https://github.com/Xangel0s/OzyBase)
